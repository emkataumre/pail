// src/run.test.ts
import { describe, it, expect, vi } from "vitest";
import { runLoop, type Deps } from "./run";
import type { Config, Task } from "./types";

const cfg = {
    trunkBranch: "main", integrationBranch: "integration/pail",
    taskSource: "github", afkLabel: "afk", humanLabel: "pail-needs-human",
    checkCommand: "c", checkTimeoutMs: 1000, maxIterations: 10,
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
        runCheck: vi.fn(async () => ({ green: true, timedOut: false })),
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

    it("flags a red task for a human, keeps the branch, does not merge", async () => {
        let served = false;
        const deps = baseDeps({
            getNextTask: vi.fn(async () => (served ? null : ((served = true), task(14)))),
            runCheck: vi.fn(async () => ({ green: false, timedOut: false })),
        });
        const report = await runLoop("/repo", deps);
        expect(deps.mergeInto).not.toHaveBeenCalled();
        expect(deps.flagForHuman).toHaveBeenCalledWith(14, "pail-needs-human", expect.stringContaining("check"));
        expect(deps.removeWorktree).toHaveBeenCalledWith("/repo", "/wt", "pail/issue-14", true);
        expect(report.needsHuman[0].issue).toBe(14);
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
