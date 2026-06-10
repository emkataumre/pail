export interface Config {
    trunkBranch: string;
    integrationBranch: string;
    taskSource: "github" | "markdown";
    afkLabel: string;
    humanLabel: string;
    blockedLabel: string;
    closeMode: "close" | "comment";
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

export interface RunReport {
    merged: number[];
    needsHuman: { issue: number; reason: string }[];
    stoppedBy: "drained" | "maxIterations" | "circuitBreaker";
}
