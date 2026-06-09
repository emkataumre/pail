// src/merge.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "./exec";
import { commitAll, mergeInto } from "./merge";

let repo: string;
async function git(args: string[], cwd = repo) {
    const r = await run("git", args, { cwd });
    if (r.code !== 0) throw new Error(r.stderr);
    return r;
}

beforeEach(async () => {
    repo = mkdtempSync(join(tmpdir(), "pail-merge-"));
    await git(["init", "-b", "main"]);
    await git(["config", "user.email", "t@t.dev"]);
    await git(["config", "user.name", "t"]);
    writeFileSync(join(repo, "a.txt"), "base");
    await git(["add", "-A"]);
    await git(["commit", "-m", "init"]);
    await git(["branch", "integration/pail"]);
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe("commitAll + mergeInto", () => {
    it("commits worktree changes and merges them onto the integration branch", async () => {
        await git(["checkout", "-b", "pail/issue-1"]);
        writeFileSync(join(repo, "b.txt"), "new");
        await commitAll(repo, "feat: add b");

        await git(["checkout", "integration/pail"]);
        const res = await mergeInto(repo, "pail/issue-1", "integration/pail");
        expect(res).toEqual({ merged: true, conflict: false });
        expect(existsSync(join(repo, "b.txt"))).toBe(true);
    });

    it("reports a conflict and leaves the tree clean", async () => {
        // integration changes a.txt one way
        await git(["checkout", "integration/pail"]);
        writeFileSync(join(repo, "a.txt"), "integration-change");
        await commitAll(repo, "int change");
        // a task branch from main changes a.txt another way
        await git(["checkout", "main"]);
        await git(["checkout", "-b", "pail/issue-2"]);
        writeFileSync(join(repo, "a.txt"), "task-change");
        await commitAll(repo, "task change");

        await git(["checkout", "integration/pail"]);
        const res = await mergeInto(repo, "pail/issue-2", "integration/pail");
        expect(res.conflict).toBe(true);
        // merge aborted → clean working tree
        const status = (await git(["status", "--porcelain"])).stdout.trim();
        expect(status).toBe("");
    });

    it("commitAll is a no-op on a clean tree", async () => {
        await git(["checkout", "integration/pail"]);
        await commitAll(repo, "nothing"); // should not throw
        expect(true).toBe(true);
    });
});
