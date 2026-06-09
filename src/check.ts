// src/check.ts
import { run, type ExecFn } from "./exec";
import type { Config } from "./types";

export async function runCheck(
    worktreePath: string,
    cfg: Config,
    exec: ExecFn = run,
): Promise<{ green: boolean; timedOut: boolean }> {
    const res = await exec(cfg.checkCommand, [], {
        cwd: worktreePath,
        timeoutMs: cfg.checkTimeoutMs,
        shell: true,
    });
    return { green: res.code === 0 && !res.timedOut, timedOut: res.timedOut };
}
