export interface Config {
    trunkBranch: string;
    integrationBranch: string;
    taskSource: "github" | "markdown";
    afkLabel: string;
    humanLabel: string;
    blockedLabel: string;
    closeMode: "close" | "comment";
    completionComment: "summary" | "terse";
    checkCommand: string;
    checkTimeoutMs: number;
    setupCommand?: string;
    setupTimeoutMs: number;
    maxIterations: number;
    maxConsecutiveFailures: number;
    branchPrefix: string;
    claudeArgs: string[];
    model?: string;
}

export interface Task {
    number: number;
    title: string;
    body: string;
    labels: string[];
}

export interface ExecResult {
    code: number;
    stdout: string;
    stderr: string;
    timedOut: boolean;
}

// One enriched record per task Pail attempted in a drain — the seam the morning report renders
// from. Additive: `RunReport.tasks` is optional, so the flat `summarize()` keeps working unchanged.
export interface TaskReport {
    number: number;
    title: string;
    status: "merged" | "needs-human";
    reason?: string; // why it was flagged (only when status is "needs-human")
    acceptance: "passed" | "failed" | "na"; // "na" when the issue carried no acceptance block
    diffstat: string; // e.g. "+40 -2"
    parent?: number; // the issue's "Parent: #N" reference, when present — drives report grouping
}

export interface RunReport {
    merged: number[];
    needsHuman: { issue: number; reason: string }[];
    stoppedBy: "drained" | "maxIterations" | "circuitBreaker";
    tasks?: TaskReport[]; // enriched per-task records; absent ⇒ renderReport falls back to summarize
}
