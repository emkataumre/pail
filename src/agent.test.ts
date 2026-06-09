// src/agent.test.ts
import { describe, it, expect, vi } from "vitest";
import { runAgent } from "./agent";
import type { Config, ExecResult } from "./types";

const cfg = { claudeArgs: ["--permission-mode", "auto"] } as Config;
const res = (code: number, stdout = "", stderr = ""): ExecResult => ({ code, stdout, stderr, timedOut: false });

describe("runAgent", () => {
    it("invokes claude -p with the prompt, claudeArgs, and cwd", async () => {
        const exec = vi.fn(async () => res(0, "done"));
        const out = await runAgent("/wt", "do the thing", cfg, exec);
        expect(exec).toHaveBeenCalledWith("claude", ["-p", "do the thing", "--permission-mode", "auto"], { cwd: "/wt" });
        expect(out.ok).toBe(true);
    });

    it("maps a non-zero exit to ok:false and captures output", async () => {
        const exec = vi.fn(async () => res(1, "partial", "boom"));
        const out = await runAgent("/wt", "p", cfg, exec);
        expect(out.ok).toBe(false);
        expect(out.output).toContain("boom");
    });
});
