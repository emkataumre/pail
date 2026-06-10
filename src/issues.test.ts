// src/issues.test.ts
import { describe, it, expect, vi } from "vitest";
import { getNextTask, closeTask, flagForHuman, completeWithoutClosing } from "./issues";
import type { Config, ExecResult } from "./types";

const cfg = { afkLabel: "afk", humanLabel: "pail-needs-human" } as Config;
const ok = (stdout = ""): ExecResult => ({ code: 0, stdout, stderr: "", timedOut: false });

// Dispatching gh fake: answers `issue list` with the given JSON, and `issue view N --json state`
// with the issue's state (default OPEN).
function fakeGh(listJson: string, states: Record<number, "OPEN" | "CLOSED"> = {}) {
    return vi.fn(async (_cmd: string, args: string[] = []) => {
        if (args[1] === "list") return ok(listJson);
        if (args[1] === "view") return ok(JSON.stringify({ state: states[Number(args[2])] ?? "OPEN" }));
        return ok("");
    });
}

describe("getNextTask", () => {
    it("returns the lowest-numbered non-blocked afk issue", async () => {
        const list = JSON.stringify([
            { number: 14, title: "B", body: "", labels: [{ name: "afk" }] },
            { number: 12, title: "A", body: "", labels: [{ name: "afk" }] },
            { number: 13, title: "C", body: "", labels: [{ name: "afk" }, { name: "blocked" }] },
        ]);
        const exec = vi.fn(async () => ok(list));
        const task = await getNextTask(cfg, [], exec);
        expect(task?.number).toBe(12);
    });

    it("skips issues already flagged for a human (pail-needs-human)", async () => {
        const list = JSON.stringify([
            { number: 12, title: "needs human", body: "", labels: [{ name: "afk" }, { name: "pail-needs-human" }] },
            { number: 15, title: "fresh", body: "", labels: [{ name: "afk" }] },
        ]);
        const exec = vi.fn(async () => ok(list));
        const task = await getNextTask(cfg, [], exec);
        expect(task?.number).toBe(15);
    });

    it("returns null when nothing is eligible", async () => {
        const exec = vi.fn(async () => ok("[]"));
        expect(await getNextTask(cfg, [], exec)).toBeNull();
    });

    it("skips issues carrying a custom blockedLabel", async () => {
        const customCfg = { afkLabel: "pail-afk", humanLabel: "pail-needs-human", blockedLabel: "pail-blocked" } as Config;
        const list = JSON.stringify([
            { number: 12, title: "held back", body: "", labels: [{ name: "pail-afk" }, { name: "pail-blocked" }] },
            { number: 15, title: "ready", body: "", labels: [{ name: "pail-afk" }] },
        ]);
        const exec = vi.fn(async () => ok(list));
        const task = await getNextTask(customCfg, [], exec);
        expect(task?.number).toBe(15);
    });

    it("skips an issue already merged this run even if the stale search index still lists it as afk", async () => {
        // GitHub's search index lags: #12 was merged this run (afk label removed) but `gh issue list`
        // can still return it. It must not be re-picked — the next eligible issue wins instead.
        const list = JSON.stringify([
            { number: 12, title: "just merged", body: "", labels: [{ name: "afk" }] },
            { number: 15, title: "fresh", body: "", labels: [{ name: "afk" }] },
        ]);
        const exec = vi.fn(async () => ok(list));
        const task = await getNextTask(cfg, [12], exec);
        expect(task?.number).toBe(15);
    });

    it("returns null when the only afk issue listed was already merged this run", async () => {
        const list = JSON.stringify([
            { number: 12, title: "just merged", body: "", labels: [{ name: "afk" }] },
        ]);
        const exec = vi.fn(async () => ok(list));
        expect(await getNextTask(cfg, [12], exec)).toBeNull();
    });
});

describe("getNextTask — Blocked-by scheduling (Rung 1)", () => {
    const dependent = (extra: object = {}) =>
        JSON.stringify([{ number: 2, title: "dependent", body: "Blocked by #1", labels: [{ name: "afk" }], ...extra }]);

    it("releases a dependent once its blocker has merged this run", async () => {
        const exec = fakeGh(dependent());
        const task = await getNextTask(cfg, [1], exec);
        expect(task?.number).toBe(2);
    });

    it("treats a closed blocker as satisfied (cross-run)", async () => {
        const exec = fakeGh(dependent(), { 1: "CLOSED" });
        const task = await getNextTask(cfg, [], exec);
        expect(task?.number).toBe(2);
    });

    it("skips a dependent whose blocker is open and not merged this run (cross-promotion guard)", async () => {
        const exec = fakeGh(dependent(), { 1: "OPEN" });
        expect(await getNextTask(cfg, [], exec)).toBeNull();
    });

    it("skips a blocked dependent but returns a later unblocked issue", async () => {
        const exec = fakeGh(
            JSON.stringify([
                { number: 2, title: "dependent", body: "Blocked by #1", labels: [{ name: "afk" }] },
                { number: 4, title: "free", body: "", labels: [{ name: "afk" }] },
            ]),
            { 1: "OPEN" },
        );
        const task = await getNextTask(cfg, [], exec);
        expect(task?.number).toBe(4);
    });

    it("requires every blocker satisfied when several are listed", async () => {
        const exec = fakeGh(
            JSON.stringify([{ number: 5, title: "multi", body: "Blocked by #1 and #3", labels: [{ name: "afk" }] }]),
            { 3: "OPEN" }, // #1 merged this run, #3 still open => not eligible
        );
        expect(await getNextTask(cfg, [1], exec)).toBeNull();
    });
});

describe("closeTask / flagForHuman", () => {
    it("closes with a comment", async () => {
        const exec = vi.fn(async () => ok());
        await closeTask(7, "done", exec);
        expect(exec).toHaveBeenCalledWith("gh", ["issue", "close", "7", "--comment", "done"]);
    });

    it("labels then comments when flagging for a human", async () => {
        const exec = vi.fn(async () => ok());
        await flagForHuman(7, cfg.humanLabel, "stuck", exec);
        expect(exec).toHaveBeenNthCalledWith(1, "gh", ["issue", "edit", "7", "--add-label", "pail-needs-human"]);
        expect(exec).toHaveBeenNthCalledWith(2, "gh", ["issue", "comment", "7", "--body", "stuck"]);
    });
});

describe("completeWithoutClosing (closeMode: comment)", () => {
    it("comments the summary and removes the afk label, leaving the issue open", async () => {
        const exec = vi.fn(async () => ok());
        await completeWithoutClosing(7, "pail-afk", "done summary", exec);
        expect(exec).toHaveBeenNthCalledWith(1, "gh", ["issue", "comment", "7", "--body", "done summary"]);
        expect(exec).toHaveBeenNthCalledWith(2, "gh", ["issue", "edit", "7", "--remove-label", "pail-afk"]);
        expect(exec.mock.calls.flat(2)).not.toContain("close");
    });
});
