// src/report.ts
import type { RunReport, TaskReport } from "./types";

export function summarize(report: RunReport): string {
    const names = report.needsHuman.length > 0
        ? ` [${report.needsHuman.map((h) => `#${h.issue}`).join(" ")}]`
        : "";
    return `merged ${report.merged.length}, needs-human ${report.needsHuman.length}${names} (${report.stoppedBy})`;
}

const ACCEPTANCE_LABEL: Record<TaskReport["acceptance"], string> = {
    passed: "acceptance passed",
    failed: "acceptance failed",
    na: "no acceptance",
};

function sliceLine(t: TaskReport): string {
    return `- #${t.number} ${t.title} · ${t.status} · ${ACCEPTANCE_LABEL[t.acceptance]} · ${t.diffstat}`;
}

// Pure renderer: an enriched RunReport → the markdown used as the promotion-PR body.
// Header summary line, one line per slice (grouped by `Parent: #N` when slices carry it, flat
// otherwise), then a needs-human section. With no enriched per-task data it is just summarize().
export function renderReport(report: RunReport): string {
    const tasks = report.tasks ?? [];
    if (tasks.length === 0) return summarize(report);

    const lines: string[] = [summarize(report)];

    const parented = tasks.filter((t) => t.parent !== undefined);
    if (parented.length === 0) {
        lines.push("", ...tasks.map(sliceLine));
    } else {
        const loose = tasks.filter((t) => t.parent === undefined);
        if (loose.length > 0) lines.push("", ...loose.map(sliceLine));
        const parents = [...new Set(parented.map((t) => t.parent!))].sort((a, b) => a - b);
        for (const p of parents) {
            lines.push("", `## Parent: #${p}`, ...parented.filter((t) => t.parent === p).map(sliceLine));
        }
    }

    const flagged = tasks.filter((t) => t.status === "needs-human");
    if (flagged.length > 0) {
        lines.push("", "## Needs human", ...flagged.map((t) => `- #${t.number} ${t.title} — ${t.reason ?? "no reason given"}`));
    }

    return lines.join("\n");
}
