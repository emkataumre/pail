// src/run.test.ts
import { describe, it, expect, vi } from "vitest";
import { runLoop, type Deps } from "./run";
import type { Config, Task } from "./types";

const cfg = {
    trunkBranch: "main", integrationBranch: "integration/pail",
    taskSource: "github", afkLabel: "afk", humanLabel: "pail-needs-human",
    blockedLabel: "blocked", closeMode: "close",
    checkCommand: "c", checkTimeoutMs: 1000, setupTimeoutMs: 1200000, maxIterations: 10,
    maxConsecutiveFailures: 2, branchPrefix: "pail", claudeArgs: [],
} as Config;

function task(n: number): Task {
    return { number: n, title: `t${n}`, body: "", labels: ["afk"] };
}

function baseDeps(over: Partial<Deps>): Deps {
    return {
        loadConfig: () => cfg,
        ensureBranch: vi.fn(async () => {}),
        checkoutBranch: vi.fn(async () => {}),
        getNextTask: vi.fn(async () => null),
        buildPrompt: () => "prompt",
        createWorktree: vi.fn(async () => "/wt"),
        runAgent: vi.fn(async () => ({ ok: true, output: "" })),
        commitAll: vi.fn(async () => {}),
        runSetup: vi.fn(async () => ({ ok: true, output: "" })),
        pruneOrphans: vi.fn(async () => []),
        runCheck: vi.fn(async () => ({ green: true, timedOut: false, output: "" })),
        mergeInto: vi.fn(async () => ({ merged: true, conflict: false })),
        closeTask: vi.fn(async () => {}),
        flagForHuman: vi.fn(async () => {}),
        removeWorktree: vi.fn(async () => {}),
        log: () => {},
        ...over,
    };
}

describe("runLoop", () => {
    it("merges + closes a green task, then drains", async () => {
        let served = false;
        const deps = baseDeps({
            getNextTask: vi.fn(async () => (served ? null : ((served = true), task(12)))),
        });
        const report = await runLoop("/repo", deps);
        expect(deps.mergeInto).toHaveBeenCalledOnce();
        expect(deps.closeTask).toHaveBeenCalledWith(12, expect.any(String));
        expect(deps.removeWorktree).toHaveBeenCalledWith("/repo", "/wt", "pail/issue-12", false);
        expect(report.merged).toEqual([12]);
        expect(report.stoppedBy).toBe("drained");
    });

    it("prunes orphan worktrees on startup and warns about unmerged work", async () => {
        const logs: string[] = [];
        const deps = baseDeps({
            pruneOrphans: vi.fn(async () => [{ branch: "pail/issue-8", worktree: "/wt8", unmergedCommits: 2, tipSha: "abc1234" }]),
            log: (m) => logs.push(m),
        });
        await runLoop("/repo", deps);
        expect(deps.pruneOrphans).toHaveBeenCalledWith("/repo", "integration/pail", "pail");
        expect(logs.some((l) => l.includes("pail/issue-8") && l.includes("abc1234") && l.includes("reflog"))).toBe(true);
    });

    it("threads merged-this-run into getNextTask (so Blocked-by can release dependents)", async () => {
        let n = 0;
        const deps = baseDeps({
            getNextTask: vi.fn(async () => (++n === 1 ? task(12) : null)),
        });
        await runLoop("/repo", deps);
        expect(deps.getNextTask).toHaveBeenNthCalledWith(2, cfg, [12]);
    });

    it("flags a red task for a human, keeps the branch, does not merge", async () => {
        let served = false;
        const deps = baseDeps({
            getNextTask: vi.fn(async () => (served ? null : ((served = true), task(14)))),
            runCheck: vi.fn(async () => ({ green: false, timedOut: false, output: "" })),
        });
        const report = await runLoop("/repo", deps);
        expect(deps.mergeInto).not.toHaveBeenCalled();
        expect(deps.flagForHuman).toHaveBeenCalledWith(14, "pail-needs-human", expect.stringContaining("check"));
        expect(deps.removeWorktree).toHaveBeenCalledWith("/repo", "/wt", "pail/issue-14", true);
        expect(report.needsHuman[0].issue).toBe(14);
    });

    it("includes the check output tail in the needs-human comment when the check fails", async () => {
        let served = false;
        const deps = baseDeps({
            getNextTask: vi.fn(async () => (served ? null : ((served = true), task(15)))),
            runCheck: vi.fn(async () => ({ green: false, timedOut: false, output: "TSError: boom on line 42" })),
        });
        await runLoop("/repo", deps);
        expect(deps.flagForHuman).toHaveBeenCalledWith(
            15,
            "pail-needs-human",
            expect.stringContaining("TSError: boom on line 42"),
        );
    });

    it("runs setupCommand before the agent and skips the agent + flags the issue if setup fails", async () => {
        let served = false;
        const setupCfg = { ...cfg, setupCommand: "npm ci", setupTimeoutMs: 1200000 } as Config;
        const deps = baseDeps({
            loadConfig: () => setupCfg,
            getNextTask: vi.fn(async () => (served ? null : ((served = true), task(16)))),
            runSetup: vi.fn(async () => ({ ok: false, output: "npm ERR! lockfile mismatch" })),
        });
        const report = await runLoop("/repo", deps);
        expect(deps.runSetup).toHaveBeenCalledWith("/wt", "npm ci", 1200000);
        expect(deps.runAgent).not.toHaveBeenCalled();
        expect(deps.flagForHuman).toHaveBeenCalledWith(
            16,
            "pail-needs-human",
            expect.stringContaining("npm ERR! lockfile mismatch"),
        );
        expect(report.needsHuman[0].issue).toBe(16);
    });

    it("stops on the circuit breaker after N consecutive failures", async () => {
        const deps = baseDeps({
            getNextTask: vi.fn(async () => task(99)), // never drains
            runAgent: vi.fn(async () => ({ ok: false, output: "fail" })),
        });
        const report = await runLoop("/repo", deps);
        expect(report.stoppedBy).toBe("circuitBreaker");
        expect(deps.flagForHuman).toHaveBeenCalledTimes(2); // maxConsecutiveFailures
    });
});
