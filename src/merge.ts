// src/merge.ts
import { run, type ExecFn } from "./exec";

async function git(repoRoot: string, args: string[], exec: ExecFn) {
    return exec("git", ["-C", repoRoot, ...args]);
}

export async function commitAll(repoRoot: string, message: string, exec: ExecFn = run): Promise<void> {
    await git(repoRoot, ["add", "-A"], exec);
    const status = await git(repoRoot, ["status", "--porcelain"], exec);
    if (status.stdout.trim() === "") return; // nothing to commit
    const res = await git(repoRoot, ["commit", "-m", message], exec);
    if (res.code !== 0) throw new Error(`Pail: git commit failed: ${res.stderr.trim()}`);
}

export async function mergeInto(
    repoRoot: string,
    taskBranch: string,
    target: string,
    exec: ExecFn = run,
): Promise<{ merged: boolean; conflict: boolean }> {
    // Caller guarantees repoRoot is checked out on `target`.
    const res = await git(repoRoot, ["merge", "--no-ff", "--no-edit", taskBranch], exec);
    if (res.code === 0) return { merged: true, conflict: false };
    // Most non-zero merges here are conflicts; abort to leave the tree clean.
    await git(repoRoot, ["merge", "--abort"], exec);
    return { merged: false, conflict: true };
}
