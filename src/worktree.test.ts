// src/worktree.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "./exec";
import { ensureBranch, checkoutBranch, createWorktree, removeWorktree } from "./worktree";

let repo: string;
async function git(args: string[], cwd = repo) {
    const r = await run("git", args, { cwd });
    if (r.code !== 0) throw new Error(r.stderr);
    return r;
}

beforeEach(async () => {
    repo = mkdtempSync(join(tmpdir(), "pail-wt-"));
    await git(["init", "-b", "main"]);
    await git(["config", "user.email", "t@t.dev"]);
    await git(["config", "user.name", "t"]);
    writeFileSync(join(repo, "a.txt"), "hi");
    await git(["add", "-A"]);
    await git(["commit", "-m", "init"]);
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe("worktree lifecycle", () => {
    it("ensures a branch, makes a worktree on it, and removes both", async () => {
        await ensureBranch(repo, "integration/pail", "main");
        await checkoutBranch(repo, "integration/pail");

        const path = await createWorktree(repo, "integration/pail", "pail/issue-1");
        expect(existsSync(path)).toBe(true);

        const branch = (await run("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: path })).stdout.trim();
        expect(branch).toBe("pail/issue-1");

        await removeWorktree(repo, path, "pail/issue-1", false);
        expect(existsSync(path)).toBe(false);
        const branches = (await git(["branch", "--list", "pail/issue-1"])).stdout.trim();
        expect(branches).toBe("");
    });
});
