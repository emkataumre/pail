// src/issues.ts
import { run, type ExecFn } from "./exec";
import type { Config, Task } from "./types";

interface GhIssue {
    number: number;
    title: string;
    body: string;
    labels: { name: string }[];
}

export async function getNextTask(cfg: Config, exec: ExecFn = run): Promise<Task | null> {
    const res = await exec("gh", [
        "issue", "list",
        "--state", "open",
        "--label", cfg.afkLabel,
        "--json", "number,title,body,labels",
        "--limit", "100",
    ]);
    if (res.code !== 0) throw new Error(`Pail: gh issue list failed: ${res.stderr}`);

    const issues = JSON.parse(res.stdout || "[]") as GhIssue[];
    const eligible = issues
        .filter((i) => !i.labels.some((l) => l.name === "blocked" || l.name === cfg.humanLabel))
        .sort((a, b) => a.number - b.number);

    const first = eligible[0];
    if (!first) return null;
    return { number: first.number, title: first.title, body: first.body, labels: first.labels.map((l) => l.name) };
}

export async function closeTask(issue: number, comment: string, exec: ExecFn = run): Promise<void> {
    const res = await exec("gh", ["issue", "close", String(issue), "--comment", comment]);
    if (res.code !== 0) throw new Error(`Pail: gh issue close ${issue} failed: ${res.stderr}`);
}

export async function flagForHuman(issue: number, label: string, comment: string, exec: ExecFn = run): Promise<void> {
    const e1 = await exec("gh", ["issue", "edit", String(issue), "--add-label", label]);
    if (e1.code !== 0) throw new Error(`Pail: gh issue edit ${issue} failed: ${e1.stderr}`);
    const e2 = await exec("gh", ["issue", "comment", String(issue), "--body", comment]);
    if (e2.code !== 0) throw new Error(`Pail: gh issue comment ${issue} failed: ${e2.stderr}`);
}
