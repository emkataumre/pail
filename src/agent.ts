// src/agent.ts
import { run, type ExecFn } from "./exec";
import type { Config } from "./types";

export async function runAgent(
    worktreePath: string,
    prompt: string,
    cfg: Config,
    exec: ExecFn = run,
): Promise<{ ok: boolean; output: string }> {
    const modelArgs = cfg.model ? ["--model", cfg.model] : [];
    const res = await exec("claude", ["-p", prompt, ...modelArgs, ...cfg.claudeArgs], { cwd: worktreePath });
    return { ok: res.code === 0, output: `${res.stdout}\n${res.stderr}`.trim() };
}
