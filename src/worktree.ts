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
