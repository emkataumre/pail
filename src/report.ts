// src/report.ts
import type { RunReport } from "./types";

export function summarize(report: RunReport): string {
    return `merged ${report.merged.length}, needs-human ${report.needsHuman.length} (${report.stoppedBy})`;
}
