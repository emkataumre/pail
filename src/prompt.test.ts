// src/prompt.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildPrompt } from "./prompt";
import type { Config, Task } from "./types";

let dir: string;
const cfg = { checkCommand: "npm run check" } as Config;
const task: Task = { number: 42, title: "Add reset", body: "Let learners reset.", labels: ["afk"] };

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pail-prompt-"));
    mkdirSync(join(dir, ".pail"));
    writeFileSync(join(dir, ".pail", "prompt.md"), "Run {checkCommand}.\n#{number}: {title}\n{body}");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("buildPrompt", () => {
    it("interpolates check command, number, title and body", () => {
        const out = buildPrompt(dir, task, cfg);
        expect(out).toBe("Run npm run check.\n#42: Add reset\nLet learners reset.");
    });
});
