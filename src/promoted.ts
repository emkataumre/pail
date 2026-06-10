// src/promoted.ts — squash-safe predicate: is the bot's integration branch already on trunk?
// Promotion squash-merges integration onto trunk, which collapses its commits into one new commit —
// destroying the ancestry/patch-id that the obvious "integration ⊆ trunk?" check would rely on. The
// squash-safe signal instead compares against the promotion branch's OWN head SHA, which the merged
// PR retains even after the branch is deleted. Read-only: it asks gh + git and performs no reset.
import { run, type ExecFn } from "./exec";
import { PROMOTE_BRANCH } from "./promote";

interface MergedPr {
    headRefOid: string;
    mergedAt: string;
}

// True ⇒ the integration tip is contained in a merged promotion branch ⇒ safe to reset onto trunk.
// False ⇒ no merged promotion PR, or the integration branch has advanced past the promoted SHA
// (a missing/unfetched head SHA also yields false — the safe verdict, since it never resets).
export async function isPromoted(repoRoot: string, integrationRef: string, exec: ExecFn = run): Promise<boolean> {
    // The promotion PR (head = PROMOTE_BRANCH) carries its head SHA even after merge/branch-delete.
    const list = await exec("gh", ["pr", "list", "--head", PROMOTE_BRANCH, "--state", "merged", "--json", "headRefOid,mergedAt"], { cwd: repoRoot });
    if (list.code !== 0) throw new Error(`isPromoted: gh pr list failed: ${list.stderr.trim()}`);

    const prs = JSON.parse(list.stdout || "[]") as MergedPr[];
    if (!Array.isArray(prs) || prs.length === 0) return false; // no merged promotion PR

    // Across drains several promotion PRs accumulate on the same branch; the latest one is the
    // promoted state to measure against (ISO timestamps compare correctly as strings).
    const latest = prs.reduce((a, b) => (b.mergedAt > a.mergedAt ? b : a));

    // Squash-safe: is the integration tip contained in the promotion branch's own history?
    const ancestry = await exec("git", ["-C", repoRoot, "merge-base", "--is-ancestor", integrationRef, latest.headRefOid]);
    return ancestry.code === 0;
}
