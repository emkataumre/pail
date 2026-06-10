// src/worktree.ts
import { join } from "node:path";
import { run, type ExecFn } from "./exec";

function sanitize(branch: string): string {
    return branch.replace(/[^a-zA-Z0-9._-]/g, "-");
}

async function git(repoRoot: string, args: string[], exec: ExecFn): Promise<string> {
    const r = await exec("git", ["-C", repoRoot, ...args]);
    if (r.code !== 0) throw new Error(`Pail: git ${args.join(" ")} failed: ${r.stderr.trim()}`);
    return r.stdout;
}

export async function ensureBranch(repoRoot: string, name: string, createFrom: string, exec: ExecFn = run): Promise<void> {
    const check = await exec("git", ["-C", repoRoot, "rev-parse", "--verify", "--quiet", name]);
    if (check.code === 0) return; // already exists
    await git(repoRoot, ["branch", name, createFrom], exec);
}

export async function checkoutBranch(repoRoot: string, name: string, exec: ExecFn = run): Promise<void> {
    await git(repoRoot, ["checkout", name], exec);
}

export async function createWorktree(repoRoot: string, fromBranch: string, branch: string, exec: ExecFn = run): Promise<string> {
    const path = join(repoRoot, ".pail", "worktrees", sanitize(branch));
    await git(repoRoot, ["worktree", "add", "-b", branch, path, fromBranch], exec);
    return path;
}

export async function removeWorktree(repoRoot: string, worktreePath: string, branch: string, keepBranch: boolean, exec: ExecFn = run): Promise<void> {
    await git(repoRoot, ["worktree", "remove", "--force", worktreePath], exec);
    if (!keepBranch) {
        await git(repoRoot, ["branch", "-D", branch], exec);
    }
}

// Prepare a fresh worktree before the agent runs (e.g. `npm install`): a worktree starts with no
// gitignored deps, so without this the agent's own first check is the slow one. Runs in the worktree
// with its own (larger) timeout — installs legitimately outlast a check.
export async function runSetup(worktreePath: string, command: string, timeoutMs: number, exec: ExecFn = run): Promise<{ ok: boolean; output: string }> {
    const res = await exec(command, [], { cwd: worktreePath, timeoutMs, shell: true });
    return { ok: res.code === 0 && !res.timedOut, output: `${res.stdout}\n${res.stderr}`.trim() };
}

export interface PrunedOrphan {
    branch: string;
    worktree: string | null;
    unmergedCommits: number;
    tipSha: string;
}

// Parse `git worktree list --porcelain` into a branch -> worktree-path map (skips detached/no-branch).
function parseWorktrees(porcelain: string): Map<string, string> {
    const map = new Map<string, string>();
    let path = "";
    for (const line of porcelain.split("\n")) {
        if (line.startsWith("worktree ")) path = line.slice("worktree ".length).trim();
        else if (line.startsWith("branch ") && path) map.set(line.slice("branch ".length).trim().replace(/^refs\/heads\//, ""), path);
        else if (line.trim() === "") path = "";
    }
    return map;
}

async function orphanInfo(repoRoot: string, integrationBranch: string, branch: string, exec: ExecFn): Promise<{ unmergedCommits: number; tipSha: string }> {
    const count = await exec("git", ["-C", repoRoot, "rev-list", "--count", `${integrationBranch}..${branch}`]);
    const sha = await exec("git", ["-C", repoRoot, "rev-parse", "--short", branch]);
    return { unmergedCommits: Number(count.stdout.trim()) || 0, tipSha: sha.stdout.trim() };
}

// Crash-resume: on startup, remove leftover `<branchPrefix>/*` worktrees + branches from a prior
// interrupted run. A healthy run cleans up its own, so any present now are orphans; left in place they
// wedge the next run — `git worktree add -b` dies on the existing branch (fatal exit 2). We force-remove
// each so the drain resumes, and report any orphan that carried unmerged commits (its tip stays
// recoverable via `git reflog`) so nothing of value is discarded silently.
export async function pruneOrphans(repoRoot: string, integrationBranch: string, branchPrefix: string, exec: ExecFn = run): Promise<PrunedOrphan[]> {
    const prefix = `${branchPrefix}/`;
    const pruned: PrunedOrphan[] = [];

    // 1) Orphan worktrees on a <prefix>/* branch.
    const wt = await exec("git", ["-C", repoRoot, "worktree", "list", "--porcelain"]);
    for (const [branch, path] of parseWorktrees(wt.stdout)) {
        if (!branch.startsWith(prefix) || branch === integrationBranch) continue;
        const info = await orphanInfo(repoRoot, integrationBranch, branch, exec);
        await git(repoRoot, ["worktree", "remove", "--force", path], exec);
        await git(repoRoot, ["branch", "-D", branch], exec);
        pruned.push({ branch, worktree: path, ...info });
    }

    // 2) Dangling <prefix>/* branches with no worktree.
    const br = await exec("git", ["-C", repoRoot, "branch", "--list", `${prefix}*`, "--format=%(refname:short)"]);
    for (const branch of br.stdout.split("\n").map((s) => s.trim()).filter(Boolean)) {
        if (branch === integrationBranch || pruned.some((p) => p.branch === branch)) continue;
        const info = await orphanInfo(repoRoot, integrationBranch, branch, exec);
        await git(repoRoot, ["branch", "-D", branch], exec);
        pruned.push({ branch, worktree: null, ...info });
    }
    return pruned;
}
