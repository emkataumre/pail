export interface Config {
    trunkBranch: string;
    integrationBranch: string;
    afkLabel: string;
    humanLabel: string;
    checkCommand: string;
    checkTimeoutMs: number;
    maxIterations: number;
    maxConsecutiveFailures: number;
    branchPrefix: string;
    claudeArgs: string[];
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

export type Outcome = "merged" | "needs-human";

export interface TaskResult {
    issue: number;
    outcome: Outcome;
    reason?: string;
}

export interface RunReport {
    merged: number[];
    needsHuman: { issue: number; reason: string }[];
    stoppedBy: "drained" | "maxIterations" | "circuitBreaker";
}
