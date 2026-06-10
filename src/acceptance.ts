// src/acceptance.ts — the runner half of executable acceptance (PRD #12, Feature 1).
// Runs an issue's "prove it" command list in its worktree, sequentially, stopping at the first
// non-zero exit or timeout. Knows nothing about issues, the loop, or reporting — a pure leaf.
import { run, type ExecFn } from "./exec";

export interface AcceptanceResult {
    ok: boolean;
    failedCommand?: string;
    output: string;
}

export async function runAcceptance(
    worktreePath: string,
    commands: string[],
    timeoutMs: number,
    exec: ExecFn = run,
): Promise<AcceptanceResult> {
    const parts: string[] = [];
    for (const command of commands) {
        const res = await exec(command, [], { cwd: worktreePath, timeoutMs, shell: true });
        const out = `${res.stdout}\n${res.stderr}`.trim();
        parts.push(`$ ${command}\n${out}`.trim());
        if (res.code !== 0 || res.timedOut) {
            return { ok: false, failedCommand: command, output: parts.join("\n\n") };
        }
    }
    return { ok: true, output: parts.join("\n\n") };
}
