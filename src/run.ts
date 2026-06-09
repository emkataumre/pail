// src/run.ts
import type { Config, Task, RunReport } from "./types";
import { loadConfig as realLoadConfig } from "./config";
import { ensureBranch as realEnsureBranch, checkoutBranch as realCheckoutBranch, createWorktree as realCreateWorktree, removeWorktree as realRemoveWorktree } from "./worktree";
import { getNextTask as realGetNextTask, closeTask as realCloseTask, flagForHuman as realFlagForHuman } from "./issues";
import { buildPrompt as realBuildPrompt } from "./prompt";
import { runAgent as realRunAgent } from "./agent";
import { runCheck as realRunCheck } from "./check";
import { commitAll as realCommitAll, mergeInto as realMergeInto } from "./merge";
import { formatSummary } from "./humanSummary";

export interface Deps {
    loadConfig: (repoRoot: string) => Config;
    ensureBranch: (repoRoot: string, name: string, from: string) => Promise<void>;
    checkoutBranch: (repoRoot: string, name: string) => Promise<void>;
    getNextTask: (cfg: Config) => Promise<Task | null>;
    buildPrompt: (repoRoot: string, task: Task, cfg: Config) => string;
    createWorktree: (repoRoot: string, from: string, branch: string) => Promise<string>;
    runAgent: (worktreePath: string, prompt: string, cfg: Config) => Promise<{ ok: boolean; output: string }>;
    commitAll: (repoRoot: string, message: string) => Promise<void>;
    runCheck: (worktreePath: string, cfg: Config) => Promise<{ green: boolean; timedOut: boolean }>;
    mergeInto: (repoRoot: string, taskBranch: string, target: string) => Promise<{ merged: boolean; conflict: boolean }>;
    closeTask: (issue: number, comment: string) => Promise<void>;
    flagForHuman: (issue: number, label: string, comment: string) => Promise<void>;
    removeWorktree: (repoRoot: string, path: string, branch: string, keepBranch: boolean) => Promise<void>;
    log: (msg: string) => void;
}

function tail(s: string, n = 1500): string {
    return s.length > n ? "…(truncated)\n" + s.slice(-n) : s;
}

export async function runLoop(repoRoot: string, deps: Deps): Promise<RunReport> {
    const cfg = deps.loadConfig(repoRoot);
    await deps.ensureBranch(repoRoot, cfg.integrationBranch, cfg.trunkBranch);
    await deps.checkoutBranch(repoRoot, cfg.integrationBranch);

    const merged: number[] = [];
    const needsHuman: { issue: number; reason: string }[] = [];
    let consecutiveFailures = 0;
    let iterations = 0;

    const fail = async (task: Task, branch: string, path: string, reason: string, detail: string) => {
        const comment = formatSummary({
            plainEnglish: `Pail could not finish #${task.number} (${task.title}) on its own.`,
            whyItMatters: `Needs a human decision before it can land. Reason: ${reason}.`,
            detail: `## What happened\n${reason}\n\n## Agent output (tail)\n\n\`\`\`\n${tail(detail)}\n\`\`\``,
        });
        await deps.flagForHuman(task.number, cfg.humanLabel, comment);
        await deps.removeWorktree(repoRoot, path, branch, true); // keep branch for inspection
        needsHuman.push({ issue: task.number, reason });
        consecutiveFailures++;
    };

    let stoppedBy: RunReport["stoppedBy"] = "drained";

    while (true) {
        if (iterations >= cfg.maxIterations) { stoppedBy = "maxIterations"; break; }
        if (consecutiveFailures >= cfg.maxConsecutiveFailures) { stoppedBy = "circuitBreaker"; break; }

        const task = await deps.getNextTask(cfg);
        if (!task) { stoppedBy = "drained"; break; }
        iterations++;

        const branch = `${cfg.branchPrefix}/issue-${task.number}`;
        deps.log(`#${task.number}: ${task.title}`);
        const path = await deps.createWorktree(repoRoot, cfg.integrationBranch, branch);

        const prompt = deps.buildPrompt(repoRoot, task, cfg);
        const agent = await deps.runAgent(path, prompt, cfg);
        await deps.commitAll(path, `pail: work on #${task.number} ${task.title}`);

        if (!agent.ok) { await fail(task, branch, path, "agent did not complete", agent.output); continue; }

        const check = await deps.runCheck(path, cfg);
        if (!check.green) {
            await fail(task, branch, path, check.timedOut ? "check timed out (hang)" : "check failed", agent.output);
            continue;
        }

        const m = await deps.mergeInto(repoRoot, branch, cfg.integrationBranch);
        if (m.conflict) { await fail(task, branch, path, "merge conflict", agent.output); continue; }

        const comment = formatSummary({
            plainEnglish: `Implemented #${task.number}: ${task.title}.`,
            whyItMatters: `Merged onto ${cfg.integrationBranch} after an independent green check.`,
            detail: `## Testing\n\`${cfg.checkCommand}\` green.`,
        });
        await deps.closeTask(task.number, comment);
        await deps.removeWorktree(repoRoot, path, branch, false);
        merged.push(task.number);
        consecutiveFailures = 0;
    }

    deps.log(`Done. merged=${merged.length} needs-human=${needsHuman.length} (${stoppedBy}).`);
    return { merged, needsHuman, stoppedBy };
}

export async function main(repoRoot: string): Promise<number> {
    const deps: Deps = {
        loadConfig: realLoadConfig,
        ensureBranch: realEnsureBranch,
        checkoutBranch: realCheckoutBranch,
        getNextTask: realGetNextTask,
        buildPrompt: realBuildPrompt,
        createWorktree: realCreateWorktree,
        runAgent: realRunAgent,
        commitAll: realCommitAll,
        runCheck: realRunCheck,
        mergeInto: realMergeInto,
        closeTask: realCloseTask,
        flagForHuman: realFlagForHuman,
        removeWorktree: realRemoveWorktree,
        log: (m) => console.log(`[pail] ${m}`),
    };
    const report = await runLoop(repoRoot, deps);
    return report.needsHuman.length > 0 ? 1 : 0;
}
