// src/issues.ts
import { run, type ExecFn } from "./exec";
import type { Config, Task } from "./types";

interface GhIssue {
    number: number;
    title: string;
    body: string;
    labels: { name: string }[];
}

// Parse "Blocked by #N" references from an issue body. Supports several refs on one line
// (e.g. "Blocked by #1 and #3") and multiple such lines.
function parseBlockedBy(body: string): number[] {
    const nums: number[] = [];
    for (const line of body.matchAll(/blocked by[^\n]*/gi)) {
        for (const ref of line[0].matchAll(/#(\d+)/g)) nums.push(Number(ref[1]));
    }
    return nums;
}

// A blocker is satisfied if it merged earlier in this same run, or it is closed (promoted to trunk).
// Note the deliberate gap: a blocker merged in a *previous* run but not yet closed is neither — so the
// dependent waits. That gap *is* the cross-promotion guard (integration may have been deleted at
// promotion before the blocker reached trunk).
async function isClosed(n: number, exec: ExecFn): Promise<boolean> {
    const res = await exec("gh", ["issue", "view", String(n), "--json", "state"]);
    if (res.code !== 0) return false; // can't confirm closed -> treat as unsatisfied (dependent waits)
    try {
        return (JSON.parse(res.stdout) as { state?: string }).state === "CLOSED";
    } catch {
        return false;
    }
}

export async function getNextTask(cfg: Config, mergedThisRun: number[] = [], exec: ExecFn = run): Promise<Task | null> {
    const res = await exec("gh", [
        "issue", "list",
        "--state", "open",
        "--label", cfg.afkLabel,
        "--json", "number,title,body,labels",
        "--limit", "100",
    ]);
    if (res.code !== 0) throw new Error(`Pail: gh issue list failed: ${res.stderr}`);

    const candidates = (JSON.parse(res.stdout || "[]") as GhIssue[])
        .filter((i) => !i.labels.some((l) => l.name === cfg.blockedLabel || l.name === cfg.humanLabel))
        .sort((a, b) => a.number - b.number);

    // Return the lowest-numbered candidate whose Blocked-by references are all satisfied.
    for (const c of candidates) {
        let eligible = true;
        for (const blocker of parseBlockedBy(c.body ?? "")) {
            if (mergedThisRun.includes(blocker)) continue;
            if (await isClosed(blocker, exec)) continue;
            eligible = false;
            break;
        }
        if (eligible) return { number: c.number, title: c.title, body: c.body, labels: c.labels.map((l) => l.name) };
    }
    return null;
}

export async function closeTask(issue: number, comment: string, exec: ExecFn = run): Promise<void> {
    const res = await exec("gh", ["issue", "close", String(issue), "--comment", comment]);
    if (res.code !== 0) throw new Error(`Pail: gh issue close ${issue} failed: ${res.stderr}`);
}

// closeMode "comment": post the summary and retire the issue from the pool (remove afk label),
// but leave it open — the human closes it at promotion time, after the work reaches trunk.
export async function completeWithoutClosing(issue: number, afkLabel: string, comment: string, exec: ExecFn = run): Promise<void> {
    const c = await exec("gh", ["issue", "comment", String(issue), "--body", comment]);
    if (c.code !== 0) throw new Error(`Pail: gh issue comment ${issue} failed: ${c.stderr}`);
    const e = await exec("gh", ["issue", "edit", String(issue), "--remove-label", afkLabel]);
    if (e.code !== 0) throw new Error(`Pail: gh issue edit ${issue} failed: ${e.stderr}`);
}

export async function flagForHuman(issue: number, label: string, comment: string, exec: ExecFn = run): Promise<void> {
    const e1 = await exec("gh", ["issue", "edit", String(issue), "--add-label", label]);
    if (e1.code !== 0) throw new Error(`Pail: gh issue edit ${issue} failed: ${e1.stderr}`);
    const e2 = await exec("gh", ["issue", "comment", String(issue), "--body", comment]);
    if (e2.code !== 0) throw new Error(`Pail: gh issue comment ${issue} failed: ${e2.stderr}`);
}
