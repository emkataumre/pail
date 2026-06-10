// src/config.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "./types";

const DEFAULTS = {
    taskSource: "github" as Config["taskSource"],
    afkLabel: "afk",
    humanLabel: "pail-needs-human",
    blockedLabel: "blocked",
    closeMode: "close" as Config["closeMode"],
    checkTimeoutMs: 180000,
    maxIterations: 10,
    maxConsecutiveFailures: 3,
    branchPrefix: "pail",
    claudeArgs: ["--permission-mode", "auto"] as string[],
};

export function loadConfig(repoRoot: string): Config {
    const path = join(repoRoot, ".pail", "config.json");

    let raw: string;
    try {
        raw = readFileSync(path, "utf8");
    } catch {
        throw new Error(`Pail: no config found at ${path}. Create .pail/config.json (see templates/config.example.json).`);
    }

    let parsed: Partial<Config>;
    try {
        parsed = JSON.parse(raw);
    } catch (e) {
        throw new Error(`Pail: ${path} is not valid JSON: ${(e as Error).message}`);
    }

    for (const field of ["trunkBranch", "integrationBranch", "checkCommand"] as const) {
        if (!parsed[field]) throw new Error(`Pail: config is missing required "${field}".`);
    }

    if (parsed.taskSource && parsed.taskSource !== "github" && parsed.taskSource !== "markdown") {
        throw new Error(`Pail: config taskSource must be "github" or "markdown", got "${parsed.taskSource}".`);
    }

    if (parsed.closeMode && parsed.closeMode !== "close" && parsed.closeMode !== "comment") {
        throw new Error(`Pail: config closeMode must be "close" or "comment", got "${parsed.closeMode}".`);
    }

    return { ...DEFAULTS, ...parsed } as Config;
}
