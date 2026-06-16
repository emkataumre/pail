// src/config.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "./config";

let dir: string;
beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pail-cfg-"));
    mkdirSync(join(dir, ".pail"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function writeConfig(obj: unknown) {
    writeFileSync(join(dir, ".pail", "config.json"), JSON.stringify(obj));
}

describe("loadConfig", () => {
    it("fills defaults around the required fields", () => {
        writeConfig({ trunkBranch: "main", integrationBranch: "integration/pail", checkCommand: "npm run check" });
        const cfg = loadConfig(dir);
        expect(cfg.afkLabel).toBe("afk");
        expect(cfg.humanLabel).toBe("pail-needs-human");
        expect(cfg.claudeArgs).toEqual(["--permission-mode", "auto"]);
        expect(cfg.checkTimeoutMs).toBe(600000);
        expect(cfg.setupTimeoutMs).toBe(1200000);
        expect(cfg.setupCommand).toBeUndefined();
    });

    it("defaults taskSource to github", () => {
        writeConfig({ trunkBranch: "main", integrationBranch: "integration/pail", checkCommand: "npm run check" });
        expect(loadConfig(dir).taskSource).toBe("github");
    });

    it("accepts taskSource markdown", () => {
        writeConfig({ trunkBranch: "main", integrationBranch: "integration/pail", checkCommand: "npm run check", taskSource: "markdown" });
        expect(loadConfig(dir).taskSource).toBe("markdown");
    });

    it("defaults blockedLabel and closeMode", () => {
        writeConfig({ trunkBranch: "main", integrationBranch: "integration/pail", checkCommand: "npm run check" });
        const cfg = loadConfig(dir);
        expect(cfg.blockedLabel).toBe("blocked");
        expect(cfg.closeMode).toBe("close");
    });

    it("defaults completionComment to summary and accepts terse", () => {
        writeConfig({ trunkBranch: "main", integrationBranch: "integration/pail", checkCommand: "npm run check" });
        expect(loadConfig(dir).completionComment).toBe("summary");
        writeConfig({ trunkBranch: "main", integrationBranch: "integration/pail", checkCommand: "npm run check", completionComment: "terse" });
        expect(loadConfig(dir).completionComment).toBe("terse");
    });

    it("rejects an unknown completionComment", () => {
        writeConfig({ trunkBranch: "main", integrationBranch: "integration/pail", checkCommand: "npm run check", completionComment: "verbose" });
        expect(() => loadConfig(dir)).toThrow(/completionComment/);
    });

    it("accepts closeMode comment and a custom blockedLabel", () => {
        writeConfig({ trunkBranch: "main", integrationBranch: "integration/pail", checkCommand: "npm run check", closeMode: "comment", blockedLabel: "pail-blocked" });
        const cfg = loadConfig(dir);
        expect(cfg.closeMode).toBe("comment");
        expect(cfg.blockedLabel).toBe("pail-blocked");
    });

    it("rejects an unknown closeMode", () => {
        writeConfig({ trunkBranch: "main", integrationBranch: "integration/pail", checkCommand: "npm run check", closeMode: "yolo" });
        expect(() => loadConfig(dir)).toThrow(/closeMode/);
    });

    it("rejects an unknown taskSource", () => {
        writeConfig({ trunkBranch: "main", integrationBranch: "integration/pail", checkCommand: "npm run check", taskSource: "jira" });
        expect(() => loadConfig(dir)).toThrow(/taskSource/);
    });

    it("throws a helpful error when a required field is missing", () => {
        writeConfig({ trunkBranch: "main" });
        expect(() => loadConfig(dir)).toThrow(/integrationBranch/);
    });

    it("throws when the file is absent", () => {
        expect(() => loadConfig(dir + "-nope")).toThrow(/config/);
    });
});
