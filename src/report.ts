// src/report.ts
import type { RunReport } from "./types";

export function summarize(report: RunReport): string {
    const names = report.needsHuman.length > 0
        ? ` [${report.needsHuman.map((h) => `#${h.issue}`).join(" ")}]`
        : "";
    return `merged ${report.merged.length}, needs-human ${report.needsHuman.length}${names} (${report.stoppedBy})`;
}
