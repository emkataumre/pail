// src/config.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "./types";

const DEFAULTS = {
    afkLabel: "afk",
    humanLabel: "pail-needs-human",
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

    return { ...DEFAULTS, ...parsed } as Config;
}
