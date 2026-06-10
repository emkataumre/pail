// src/acceptance.test.ts
import { describe, it, expect, vi } from "vitest";
import { runAcceptance } from "./acceptance";
import type { ExecResult } from "./types";

const res = (stdout = "", code = 0, timedOut = false, stderr = ""): ExecResult => ({ code, stdout, stderr, timedOut });

describe("runAcceptance", () => {
    it("runs each command sequentially in the worktree via the exec seam, returning ok when all pass", async () => {
        const calls: { cmd: string; args: string[]; opts: any }[] = [];
        const exec = vi.fn(async (cmd: string, args: string[] = [], opts: any = {}) => {
            calls.push({ cmd, args, opts });
            return res(`ran ${cmd}`);
        });

        const r = await runAcceptance("/wt", ["echo a", "echo b"], 5000, exec);

        expect(r.ok).toBe(true);
        expect(r.failedCommand).toBeUndefined();
        expect(calls.map((c) => c.cmd)).toEqual(["echo a", "echo b"]);
        expect(calls.every((c) => c.opts.cwd === "/wt" && c.opts.shell === true && c.opts.timeoutMs === 5000)).toBe(true);
    });

    it("stops at the first failing command (fail-fast) and reports which one", async () => {
        const ran: string[] = [];
        const exec = vi.fn(async (cmd: string) => {
            ran.push(cmd);
            return cmd === "boom" ? res("nope", 1) : res("fine");
        });

        const r = await runAcceptance("/wt", ["ok-1", "boom", "ok-2"], 5000, exec);

        expect(r.ok).toBe(false);
        expect(r.failedCommand).toBe("boom");
        expect(ran).toEqual(["ok-1", "boom"]); // ok-2 must never run
    });

    it("treats a timed-out command as a failure and stops", async () => {
        const ran: string[] = [];
        const exec = vi.fn(async (cmd: string) => {
            ran.push(cmd);
            return cmd === "hang" ? res("", -1, true) : res();
        });

        const r = await runAcceptance("/wt", ["hang", "after"], 100, exec);

        expect(r.ok).toBe(false);
        expect(r.failedCommand).toBe("hang");
        expect(ran).toEqual(["hang"]); // nothing after the timeout
    });

    it("captures the combined output of the commands it ran", async () => {
        const exec = vi.fn(async (cmd: string) =>
            cmd === "first" ? res("first-out") : res("second-out", 1, false, "second-err"),
        );

        const r = await runAcceptance("/wt", ["first", "second"], 5000, exec);

        expect(r.ok).toBe(false);
        expect(r.output).toContain("first-out");
        expect(r.output).toContain("second-out");
        expect(r.output).toContain("second-err");
    });

    it("is trivially ok with an empty command list and runs nothing", async () => {
        const exec = vi.fn(async () => res());
        const r = await runAcceptance("/wt", [], 5000, exec);
        expect(r.ok).toBe(true);
        expect(exec).not.toHaveBeenCalled();
    });
});
