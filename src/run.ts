// src/run.ts
import type { Config, Task, RunReport, TaskReport } from "./types";
import { loadConfig as realLoadConfig } from "./config";
import { ensureBranch as realEnsureBranch, checkoutBranch as realCheckoutBranch, createWorktree as realCreateWorktree, removeWorktree as realRemoveWorktree, runSetup as realRunSetup, pruneOrphans as realPruneOrphans } from "./worktree";
import { getNextTask as realGetNextTask, closeTask as realCloseTask, flagForHuman as realFlagForHuman, completeWithoutClosing, parseAcceptance } from "./issues";
import { getNextTaskMd, closeTaskMd, flagForHumanMd } from "./tasksMd";
import { buildPrompt as realBuildPrompt } from "./prompt";
import { runAgent as realRunAgent } from "./agent";
import { runAcceptance as realRunAcceptance } from "./acceptance";
import { runCheck as realRunCheck } from "./check";
import { commitAll as realCommitAll, mergeInto as realMergeInto, diffStat as realDiffStat } from "./merge";
import { formatSummary } from "./humanSummary";
import { summarize } from "./report";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export interface Deps {
    loadConfig: (repoRoot: string) => Config;
    ensureBranch: (repoRoot: string, name: string, from: string) => Promise<void>;
    checkoutBranch: (repoRoot: string, name: string) => Promise<void>;
    getNextTask: (cfg: Config, mergedThisRun: number[]) => Promise<Task | null>;
    buildPrompt: (repoRoot: string, task: Task, cfg: Config) => string;
    createWorktree: (repoRoot: string, from: string, branch: string) => Promise<string>;
    runSetup: (worktreePath: string, command: string, timeoutMs: number) => Promise<{ ok: boolean; output: string }>;
    pruneOrphans: (repoRoot: string, integrationBranch: string, branchPrefix: string) => Promise<{ branch: string; worktree: string | null; unmergedCommits: number; tipSha: string }[]>;
    runAgent: (worktreePath: string, prompt: string, cfg: Config) => Promise<{ ok: boolean; output: string }>;
    commitAll: (repoRoot: string, message: string) => Promise<void>;
    runCheck: (worktreePath: string, cfg: Config) => Promise<{ green: boolean; timedOut: boolean; output: string }>;
    runAcceptance: (worktreePath: string, commands: string[], timeoutMs: number) => Promise<{ ok: boolean; failedCommand?: string; output: string }>;
    mergeInto: (repoRoot: string, taskBranch: string, target: string) => Promise<{ merged: boolean; conflict: boolean }>;
    diffStat: (repoRoot: string, base: string, branch: string) => Promise<string>;
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

    // Crash-resume: clear orphan worktrees/branches from a prior interrupted run before the loop,
    // so createWorktree can't collide on a leftover branch (fatal exit 2).
    for (const o of await deps.pruneOrphans(repoRoot, cfg.integrationBranch, cfg.branchPrefix)) {
        deps.log(
            o.unmergedCommits > 0
                ? `Pruned orphan ${o.branch} (${o.unmergedCommits} unmerged commit(s); tip ${o.tipSha} recoverable via 'git reflog').`
                : `Pruned clean orphan ${o.branch}.`,
        );
    }

    const merged: number[] = [];
    const needsHuman: { issue: number; reason: string }[] = [];
    const tasks: TaskReport[] = [];
    let consecutiveFailures = 0;
    let iterations = 0;

    const fail = async (task: Task, branch: string, path: string, reason: string, outputs: { label: string; output: string }[], acceptance: TaskReport["acceptance"] = "na") => {
        const blocks = outputs
            .filter((o) => o.output.trim())
            .map((o) => `## ${o.label} (tail)\n\n\`\`\`\n${tail(o.output)}\n\`\`\``)
            .join("\n\n");
        const comment = formatSummary({
            plainEnglish: `Pail could not finish #${task.number} (${task.title}) on its own.`,
            whyItMatters: `Needs a human decision before it can land. Reason: ${reason}.`,
            detail: `## What happened\n${reason}${blocks ? `\n\n${blocks}` : ""}`,
        });
        await deps.flagForHuman(task.number, cfg.humanLabel, comment);
        await deps.removeWorktree(repoRoot, path, branch, true); // keep branch for inspection
        needsHuman.push({ issue: task.number, reason });
        tasks.push({ number: task.number, title: task.title, status: "needs-human", reason, acceptance, diffstat: await deps.diffStat(repoRoot, cfg.integrationBranch, branch) });
        consecutiveFailures++;
    };

    let stoppedBy: RunReport["stoppedBy"] = "drained";

    while (true) {
        if (iterations >= cfg.maxIterations) { stoppedBy = "maxIterations"; break; }
        if (consecutiveFailures >= cfg.maxConsecutiveFailures) { stoppedBy = "circuitBreaker"; break; }

        const task = await deps.getNextTask(cfg, [...merged]);
        if (!task) { stoppedBy = "drained"; break; }
        iterations++;
        let acceptance: TaskReport["acceptance"] = "na";

        const branch = `${cfg.branchPrefix}/issue-${task.number}`;
        deps.log(`#${task.number}: ${task.title}`);
        const path = await deps.createWorktree(repoRoot, cfg.integrationBranch, branch);

        if (cfg.setupCommand) {
            const setup = await deps.runSetup(path, cfg.setupCommand, cfg.setupTimeoutMs);
            if (!setup.ok) {
                await fail(task, branch, path, "setup command failed", [{ label: "Setup output", output: setup.output }]);
                continue;
            }
        }

        const prompt = deps.buildPrompt(repoRoot, task, cfg);
        const agent = await deps.runAgent(path, prompt, cfg);
        await deps.commitAll(path, `pail: work on #${task.number} ${task.title}`);

        if (!agent.ok) { await fail(task, branch, path, "agent did not complete", [{ label: "Agent output", output: agent.output }]); continue; }

        const check = await deps.runCheck(path, cfg);
        if (!check.green) {
            await fail(task, branch, path, check.timedOut ? "check timed out (hang)" : "check failed", [
                { label: "Agent output", output: agent.output },
                { label: "Check output", output: check.output },
            ]);
            continue;
        }

        // Independent acceptance gate: if the issue carries a `## Acceptance` block, Pail runs it
        // itself (test-author ≠ implementer) after the global check is green, before merging.
        const acceptanceCommands = parseAcceptance(task.body);
        if (acceptanceCommands.length > 0) {
            const acc = await deps.runAcceptance(path, acceptanceCommands, cfg.checkTimeoutMs);
            acceptance = acc.ok ? "passed" : "failed";
            if (!acc.ok) {
                await fail(task, branch, path, `acceptance failed: ${acc.failedCommand}`, [
                    { label: "Agent output", output: agent.output },
                    { label: "Acceptance output", output: acc.output },
                ], acceptance);
                continue;
            }
        }

        const diffstat = await deps.diffStat(repoRoot, cfg.integrationBranch, branch);
        const m = await deps.mergeInto(repoRoot, branch, cfg.integrationBranch);
        if (m.conflict) { await fail(task, branch, path, "merge conflict", [{ label: "Agent output", output: agent.output }], acceptance); continue; }

        const comment = cfg.completionComment === "terse"
            ? `Pail: merged onto ${cfg.integrationBranch}, check green (${diffstat}).`
            : formatSummary({
                plainEnglish: `Implemented #${task.number}: ${task.title}.`,
                whyItMatters: `Merged onto ${cfg.integrationBranch} after an independent green check.`,
                detail: `## Testing\n\`${cfg.checkCommand}\` green.`,
            });
        await deps.closeTask(task.number, comment);
        await deps.removeWorktree(repoRoot, path, branch, false);
        merged.push(task.number);
        tasks.push({ number: task.number, title: task.title, status: "merged", acceptance, diffstat });
        consecutiveFailures = 0;
    }

    const report: RunReport = { merged, needsHuman, stoppedBy, tasks };
    deps.log(summarize(report));
    return report;
}

export async function main(repoRoot: string): Promise<number> {
    const cfg = realLoadConfig(repoRoot);
    const markdown = cfg.taskSource === "markdown";
    const deps: Deps = {
        loadConfig: () => cfg,
        ensureBranch: realEnsureBranch,
        checkoutBranch: realCheckoutBranch,
        getNextTask: markdown ? async () => getNextTaskMd(repoRoot) : realGetNextTask,
        buildPrompt: realBuildPrompt,
        createWorktree: realCreateWorktree,
        runSetup: realRunSetup,
        pruneOrphans: realPruneOrphans,
        runAgent: realRunAgent,
        commitAll: realCommitAll,
        runCheck: realRunCheck,
        runAcceptance: realRunAcceptance,
        mergeInto: realMergeInto,
        diffStat: realDiffStat,
        closeTask: markdown
            ? async (n, c) => closeTaskMd(repoRoot, n, c)
            : cfg.closeMode === "comment"
              ? async (n, c) => completeWithoutClosing(n, cfg.afkLabel, c)
              : realCloseTask,
        flagForHuman: markdown ? async (n, _label, c) => flagForHumanMd(repoRoot, n, c) : realFlagForHuman,
        removeWorktree: realRemoveWorktree,
        log: (m) => console.log(`[pail] ${m}`),
    };
    const report = await runLoop(repoRoot, deps);
    // Persist the run report so the operator-side drain can render it as the promotion-PR body.
    try {
        mkdirSync(join(repoRoot, ".pail"), { recursive: true });
        writeFileSync(join(repoRoot, ".pail", "last-run-report.json"), JSON.stringify(report, null, 2));
    } catch { /* report persistence is best-effort; never fail a run over it */ }
    return report.needsHuman.length > 0 ? 1 : 0;
}
