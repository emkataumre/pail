// src/promote.test.ts
import { describe, it, expect, vi } from "vitest";
import { promote } from "./promote";
import type { Config, ExecResult } from "./types";

const ok = (stdout = "", code = 0): ExecResult => ({ code, stdout, stderr: "", timedOut: false });
const cfg = { trunkBranch: "main", integrationBranch: "integration/pail", branchPrefix: "pail" } as Config;

describe("promote", () => {
    it("opens a PR for the bot's merged issues, with Closes #N", async () => {
        const calls: string[] = [];
        const exec = vi.fn(async (cmd: string, args: string[] = []) => {
            calls.push([cmd, ...args].join(" "));
            if (cmd === "git" && args.includes("log"))
                return ok("Merge branch 'pail/issue-7' into integration/pail\nMerge branch 'pail/issue-6' into integration/pail\n");
            if (cmd === "gh") return ok("https://github.com/emkataumre/pail/pull/42\n");
            return ok();
        });

        const res = await promote("/op", "bot", cfg, exec);

        expect(res.conflict).toBe(false);
        expect(res.merged.slice().sort((a, b) => a - b)).toEqual([6, 7]);
        expect(res.prUrl).toBe("https://github.com/emkataumre/pail/pull/42");
        expect(calls.some((c) => c.startsWith("git -C /op push -f origin pail-promote"))).toBe(true);
        const gh = calls.find((c) => c.startsWith("gh pr create"))!;
        expect(gh).toContain("--base main");
        expect(gh).toContain("Closes #7");
        expect(gh).toContain("Closes #6");
    });

    it("does nothing when there is no merged work to promote", async () => {
        const exec = vi.fn(async () => ok()); // log returns empty -> nothing merged
        const res = await promote("/op", "bot", cfg, exec);
        expect(res.prUrl).toBeNull();
        expect(res.merged).toEqual([]);
        expect(exec).not.toHaveBeenCalledWith("gh", expect.anything(), expect.anything());
    });

    it("aborts and reports a conflict when trunk doesn't merge cleanly (no push, no PR)", async () => {
        const calls: string[] = [];
        const exec = vi.fn(async (cmd: string, args: string[] = []) => {
            calls.push([cmd, ...args].join(" "));
            if (cmd === "git" && args.includes("log")) return ok("Merge branch 'pail/issue-7' into integration/pail\n");
            if (cmd === "git" && args.includes("merge") && !args.includes("--abort")) return ok("CONFLICT (content)", 1);
            return ok();
        });

        const res = await promote("/op", "bot", cfg, exec);

        expect(res.conflict).toBe(true);
        expect(res.prUrl).toBeNull();
        expect(calls.some((c) => c.includes("merge --abort"))).toBe(true);
        expect(calls.some((c) => c.includes("push"))).toBe(false);
        expect(calls.some((c) => c.startsWith("gh"))).toBe(false);
    });
});
