// src/prompt.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Config, Task } from "./types";

export function buildPrompt(repoRoot: string, task: Task, cfg: Config): string {
    const path = join(repoRoot, ".pail", "prompt.md");
    let template: string;
    try {
        template = readFileSync(path, "utf8");
    } catch {
        throw new Error(`Pail: no prompt template at ${path}. Create .pail/prompt.md.`);
    }
    return template
        .replaceAll("{checkCommand}", cfg.checkCommand)
        .replaceAll("{number}", String(task.number))
        .replaceAll("{title}", task.title)
        .replaceAll("{body}", task.body ?? "");
}
