// src/tasksMd.ts — markdown task source (.pail/tasks.md), the gh-free alternative to issues.ts
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Task } from "./types";

const HEADING = /^## (\d+): (.*?)\r?$/;
const STATUS = /^\*\*Status:\*\*\s*(\S+)/;

interface Section {
    number: number;
    title: string;
    status: string;
    headingLine: number;
    statusLine: number | null;
    endLine: number; // exclusive: index of next heading, or lines.length
}

function tasksPath(repoRoot: string): string {
    return join(repoRoot, ".pail", "tasks.md");
}

function readLines(repoRoot: string): string[] {
    let raw: string;
    try {
        raw = readFileSync(tasksPath(repoRoot), "utf8");
    } catch {
        throw new Error(`Pail: no task list at ${tasksPath(repoRoot)}. Create .pail/tasks.md (taskSource is "markdown").`);
    }
    return raw.split("\n");
}

function parseSections(lines: string[]): Section[] {
    const sections: Section[] = [];
    for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(HEADING);
        if (!m) continue;
        if (sections.length > 0) sections[sections.length - 1].endLine = i;
        sections.push({ number: Number(m[1]), title: m[2], status: "open", headingLine: i, statusLine: null, endLine: lines.length });
    }
    for (const s of sections) {
        for (let i = s.headingLine + 1; i < s.endLine; i++) {
            const m = lines[i].match(STATUS);
            if (m) {
                s.status = m[1];
                s.statusLine = i;
                break;
            }
        }
    }
    return sections;
}

export function getNextTaskMd(repoRoot: string): Task | null {
    const lines = readLines(repoRoot);
    const open = parseSections(lines).find((s) => s.status === "open");
    if (!open) return null;

    const body = lines
        .slice(open.headingLine + 1, open.endLine)
        .filter((_, i) => open.headingLine + 1 + i !== open.statusLine)
        .join("\n")
        .replace(/\r/g, "")
        .trim();
    return { number: open.number, title: open.title, body, labels: [] };
}

function setStatus(repoRoot: string, number: number, status: string, comment: string): void {
    const lines = readLines(repoRoot);
    const section = parseSections(lines).find((s) => s.number === number);
    if (!section) throw new Error(`Pail: task ${number} not found in ${tasksPath(repoRoot)}.`);

    const statusText = `**Status:** ${status}`;
    if (section.statusLine !== null) {
        lines[section.statusLine] = statusText;
    } else {
        lines.splice(section.headingLine + 1, 0, statusText);
        section.endLine++;
    }
    lines.splice(section.endLine, 0, "", ...comment.split(/\r?\n/), "");

    writeFileSync(tasksPath(repoRoot), lines.join("\n"));
}

export function closeTaskMd(repoRoot: string, number: number, comment: string): void {
    setStatus(repoRoot, number, "done", comment);
}

export function flagForHumanMd(repoRoot: string, number: number, comment: string): void {
    setStatus(repoRoot, number, "needs-human", comment);
}
