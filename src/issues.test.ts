// src/issues.test.ts
import { describe, it, expect, vi } from "vitest";
import { getNextTask, closeTask, flagForHuman, completeWithoutClosing } from "./issues";
import type { Config, ExecResult } from "./types";

const cfg = { afkLabel: "afk", humanLabel: "pail-needs-human" } as Config;
const ok = (stdout = ""): ExecResult => ({ code: 0, stdout, stderr: "", timedOut: false });

describe("getNextTask", () => {
    it("returns the lowest-numbered non-blocked afk issue", async () => {
        const list = JSON.stringify([
            { number: 14, title: "B", body: "", labels: [{ name: "afk" }] },
            { number: 12, title: "A", body: "", labels: [{ name: "afk" }] },
            { number: 13, title: "C", body: "", labels: [{ name: "afk" }, { name: "blocked" }] },
        ]);
        const exec = vi.fn(async () => ok(list));
        const task = await getNextTask(cfg, exec);
        expect(task?.number).toBe(12);
    });

    it("skips issues already flagged for a human (pail-needs-human)", async () => {
        const list = JSON.stringify([
            { number: 12, title: "needs human", body: "", labels: [{ name: "afk" }, { name: "pail-needs-human" }] },
            { number: 15, title: "fresh", body: "", labels: [{ name: "afk" }] },
        ]);
        const exec = vi.fn(async () => ok(list));
        const task = await getNextTask(cfg, exec);
        expect(task?.number).toBe(15);
    });

    it("returns null when nothing is eligible", async () => {
        const exec = vi.fn(async () => ok("[]"));
        expect(await getNextTask(cfg, exec)).toBeNull();
    });

    it("skips issues carrying a custom blockedLabel", async () => {
        const customCfg = { afkLabel: "pail-afk", humanLabel: "pail-needs-human", blockedLabel: "pail-blocked" } as Config;
        const list = JSON.stringify([
            { number: 12, title: "held back", body: "", labels: [{ name: "pail-afk" }, { name: "pail-blocked" }] },
            { number: 15, title: "ready", body: "", labels: [{ name: "pail-afk" }] },
        ]);
        const exec = vi.fn(async () => ok(list));
        const task = await getNextTask(customCfg, exec);
        expect(task?.number).toBe(15);
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
