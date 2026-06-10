// src/promote.ts — Option C: from the operator's clone, turn a finished bot drain into a review-ready
// PR. The bot stays push-less; this runs with the operator's credentials and does the one network write.
import { run, type ExecFn } from "./exec";
import type { Config } from "./types";

export interface PromoteResult {
    prUrl: string | null;
    merged: number[];
    conflict: boolean;
    reason?: string;
}

type PromoteConfig = Pick<Config, "trunkBranch" | "integrationBranch" | "branchPrefix">;

const PROMOTE_BRANCH = "pail-promote";

export async function promote(repoRoot: string, botRemote: string, cfg: PromoteConfig, exec: ExecFn = run): Promise<PromoteResult> {
    const git = (args: string[]) => exec("git", ["-C", repoRoot, ...args]);

    await git(["fetch", botRemote]);
    await git(["fetch", "origin"]);

    // What landed this drain: the merge commits Pail creates ("Merge branch 'pail/issue-N'...") encode
    // the issue numbers, so we read them straight off the bot's integration branch — no report file.
    const log = await git(["log", "--merges", "--format=%s", `origin/${cfg.trunkBranch}..${botRemote}/${cfg.integrationBranch}`]);
    const re = new RegExp(`${cfg.branchPrefix}/issue-(\\d+)`, "g");
    const merged = [...new Set([...log.stdout.matchAll(re)].map((m) => Number(m[1])))];
    if (merged.length === 0) return { prUrl: null, merged: [], conflict: false, reason: "nothing to promote" };

    // Build the promotion branch from the bot's integration branch, brought up to date with trunk.
    await git(["checkout", "-B", PROMOTE_BRANCH, `${botRemote}/${cfg.integrationBranch}`]);
    const merge = await git(["merge", "--no-edit", `origin/${cfg.trunkBranch}`]);
    if (merge.code !== 0) {
        await git(["merge", "--abort"]);
        return { prUrl: null, merged, conflict: true, reason: "integration conflicts with trunk; resolve manually before promoting" };
    }

    const push = await git(["push", "-f", "origin", PROMOTE_BRANCH]);
    if (push.code !== 0) throw new Error(`Pail promote: push failed: ${push.stderr.trim()}`);

    const title = `Pail: promote ${merged.length} issue${merged.length === 1 ? "" : "s"}`;
    const body = ["Autonomous batch promotion of Pail's merged work — review and merge to land it on trunk.", "", ...merged.map((n) => `Closes #${n}`)].join("\n");
    const pr = await exec("gh", ["pr", "create", "--base", cfg.trunkBranch, "--head", PROMOTE_BRANCH, "--title", title, "--body", body], { cwd: repoRoot });
    if (pr.code !== 0) throw new Error(`Pail promote: gh pr create failed: ${pr.stderr.trim()}`);

    return { prUrl: pr.stdout.trim(), merged, conflict: false };
}
