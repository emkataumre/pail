// src/promoted.test.ts
import { describe, it, expect, vi } from "vitest";
import { isPromoted } from "./promoted";
import type { ExecResult } from "./types";

const ok = (stdout = "", code = 0): ExecResult => ({ code, stdout, stderr: "", timedOut: false });

describe("isPromoted", () => {
    it("true: a merged promotion PR whose head SHA has the integration tip as an ancestor", async () => {
        const calls: string[] = [];
        const exec = vi.fn(async (cmd: string, args: string[] = []) => {
            calls.push([cmd, ...args].join(" "));
            if (cmd === "gh") return ok(JSON.stringify([{ headRefOid: "promotedSha", mergedAt: "2026-06-10T00:00:00Z" }]));
            if (cmd === "git" && args.includes("merge-base")) return ok(); // exit 0 => is ancestor
            return ok();
        });

        const res = await isPromoted("/bot", "integration/pail", exec);

        expect(res).toBe(true);
        // merged status + head SHA come from gh, scoped to the promotion branch.
        const gh = calls.find((c) => c.startsWith("gh"))!;
        expect(gh).toContain("--head pail-promote");
        expect(gh).toContain("--state merged");
        // ancestry checked via git merge-base --is-ancestor <integration tip> <head SHA>.
        expect(calls).toContain("git -C /bot merge-base --is-ancestor integration/pail promotedSha");
    });

    it("false: no merged promotion PR (and no ancestry check is attempted)", async () => {
        const calls: string[] = [];
        const exec = vi.fn(async (cmd: string, args: string[] = []) => {
            calls.push([cmd, ...args].join(" "));
            if (cmd === "gh") return ok("[]"); // no merged promotion PR
            return ok();
        });

        const res = await isPromoted("/bot", "integration/pail", exec);

        expect(res).toBe(false);
        expect(calls.some((c) => c.includes("merge-base"))).toBe(false);
    });

    it("false: merged, but the integration branch has advanced past the promoted SHA", async () => {
        const exec = vi.fn(async (cmd: string, args: string[] = []) => {
            if (cmd === "gh") return ok(JSON.stringify([{ headRefOid: "oldPromotedSha", mergedAt: "2026-06-10T00:00:00Z" }]));
            if (cmd === "git" && args.includes("merge-base")) return ok("", 1); // exit 1 => not an ancestor
            return ok();
        });

        expect(await isPromoted("/bot", "integration/pail", exec)).toBe(false);
    });

    it("uses the most recently merged promotion PR's head SHA when several exist", async () => {
        const calls: string[] = [];
        const exec = vi.fn(async (cmd: string, args: string[] = []) => {
            calls.push([cmd, ...args].join(" "));
            if (cmd === "gh")
                return ok(
                    JSON.stringify([
                        { headRefOid: "older", mergedAt: "2026-06-08T00:00:00Z" },
                        { headRefOid: "newest", mergedAt: "2026-06-10T00:00:00Z" },
                        { headRefOid: "middle", mergedAt: "2026-06-09T00:00:00Z" },
                    ]),
                );
            if (cmd === "git" && args.includes("merge-base")) return ok();
            return ok();
        });

        expect(await isPromoted("/bot", "integration/pail", exec)).toBe(true);
        expect(calls).toContain("git -C /bot merge-base --is-ancestor integration/pail newest");
    });

    it("performs no destructive action — only reads merged status and ancestry", async () => {
        const calls: string[] = [];
        const exec = vi.fn(async (cmd: string, args: string[] = []) => {
            calls.push([cmd, ...args].join(" "));
            if (cmd === "gh") return ok(JSON.stringify([{ headRefOid: "sha", mergedAt: "2026-06-10T00:00:00Z" }]));
            return ok();
        });

        await isPromoted("/bot", "integration/pail", exec);

        const forbidden = ["reset", "push", "checkout", "merge --no-edit", "branch -D", "rebase"];
        expect(calls.some((c) => forbidden.some((f) => c.includes(f)))).toBe(false);
    });

    it("throws when gh fails, rather than guessing a verdict", async () => {
        const exec = vi.fn(async (cmd: string) => (cmd === "gh" ? ok("", 1) : ok()));
        await expect(isPromoted("/bot", "integration/pail", exec)).rejects.toThrow(/gh pr list/);
    });
});
