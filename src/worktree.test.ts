// src/worktree.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "./exec";
import { ensureBranch, checkoutBranch, createWorktree, removeWorktree, runSetup, pruneOrphans } from "./worktree";

const NODE = process.execPath;

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

describe("runSetup", () => {
    it("runs the setup command inside the worktree and reports success", async () => {
        const path = await createWorktree(repo, "main", "pail/issue-2");
        const r = await runSetup(path, `"${NODE}" -e "require('fs').writeFileSync('setup-marker.txt','ok')"`, 5000);
        expect(r.ok).toBe(true);
        expect(existsSync(join(path, "setup-marker.txt"))).toBe(true);
    });

    it("reports failure and captures output when the setup command exits non-zero", async () => {
        const path = await createWorktree(repo, "main", "pail/issue-3");
        const r = await runSetup(path, `"${NODE}" -e "console.error('boom'); process.exit(1)"`, 5000);
        expect(r.ok).toBe(false);
        expect(r.output).toContain("boom");
    });
});

describe("pruneOrphans", () => {
    it("removes orphan worktrees + branches, reporting any unmerged work", async () => {
        await ensureBranch(repo, "integration/pail", "main");
        await checkoutBranch(repo, "integration/pail");

        // Clean orphan: a worktree + branch with no commits beyond integration (crash before any commit).
        const cleanPath = await createWorktree(repo, "integration/pail", "pail/issue-9");

        // Dirty orphan: a worktree + branch carrying one unmerged commit (agent committed, then crashed).
        const dirtyPath = await createWorktree(repo, "integration/pail", "pail/issue-8");
        writeFileSync(join(dirtyPath, "wip.txt"), "wip");
        await git(["add", "-A"], dirtyPath);
        await git(["commit", "-m", "wip"], dirtyPath);

        const pruned = await pruneOrphans(repo, "integration/pail", "pail");

        // both worktrees + branches are gone
        expect(existsSync(cleanPath)).toBe(false);
        expect(existsSync(dirtyPath)).toBe(false);
        expect((await git(["branch", "--list", "pail/*"])).stdout.trim()).toBe("");

        // reported, with the unmerged count + recoverable tip sha
        const byBranch = Object.fromEntries(pruned.map((p) => [p.branch, p]));
        expect(byBranch["pail/issue-9"].unmergedCommits).toBe(0);
        expect(byBranch["pail/issue-8"].unmergedCommits).toBe(1);
        expect(byBranch["pail/issue-8"].tipSha).toMatch(/^[0-9a-f]{7,}$/);
    });

    it("is a no-op when there are no orphans", async () => {
        await ensureBranch(repo, "integration/pail", "main");
        await checkoutBranch(repo, "integration/pail");
        expect(await pruneOrphans(repo, "integration/pail", "pail")).toEqual([]);
    });
});
