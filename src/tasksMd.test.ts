// src/tasksMd.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getNextTaskMd, closeTaskMd, flagForHumanMd } from "./tasksMd";

let dir: string;
beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pail-tasks-"));
    mkdirSync(join(dir, ".pail"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function writeTasks(md: string) {
    writeFileSync(join(dir, ".pail", "tasks.md"), md);
}
function readTasks(): string {
    return readFileSync(join(dir, ".pail", "tasks.md"), "utf8");
}

const SAMPLE = `# Inact batch — preamble is ignored

## 6630: BaseDialog should close on Esc
**Status:** done

Already handled.

## 6620: Tooltip cuts off on limit column
**Status:** open

The tooltip on the limit column clips at the grid edge.
See .pail/shot-6620.png.

## 6645: End2end popup polish
**Status:** needs-human

Stuck earlier.

## 6647: Users table sorting
**Status:** open

Sort by name, then role.
`;

describe("getNextTaskMd", () => {
    it("returns the first open task in file order (not lowest number)", () => {
        writeTasks(SAMPLE);
        const task = getNextTaskMd(dir);
        expect(task?.number).toBe(6620);
        expect(task?.title).toBe("Tooltip cuts off on limit column");
    });

    it("excludes the heading and status line from the body, keeps the rest", () => {
        writeTasks(SAMPLE);
        const task = getNextTaskMd(dir);
        expect(task?.body).toContain("clips at the grid edge");
        expect(task?.body).toContain(".pail/shot-6620.png");
        expect(task?.body).not.toContain("**Status:**");
        expect(task?.body).not.toContain("## 6645");
    });

    it("skips done and needs-human sections", () => {
        writeTasks(SAMPLE.replace("## 6620: Tooltip cuts off on limit column\n**Status:** open", "## 6620: Tooltip cuts off on limit column\n**Status:** needs-human"));
        expect(getNextTaskMd(dir)?.number).toBe(6647);
    });

    it("treats a section without a Status line as open", () => {
        writeTasks("## 7: No status here\n\nJust a body.\n");
        const task = getNextTaskMd(dir);
        expect(task?.number).toBe(7);
        expect(task?.body).toBe("Just a body.");
    });

    it("returns null when no task is open", () => {
        writeTasks("## 1: A\n**Status:** done\n\n## 2: B\n**Status:** needs-human\n");
        expect(getNextTaskMd(dir)).toBeNull();
    });

    it("throws a helpful error when tasks.md is missing", () => {
        expect(() => getNextTaskMd(dir)).toThrow(/tasks\.md/);
    });

    it("handles CRLF files", () => {
        writeTasks("## 9: Windows authored\r\n**Status:** open\r\n\r\nBody line.\r\n");
        const task = getNextTaskMd(dir);
        expect(task?.number).toBe(9);
        expect(task?.title).toBe("Windows authored");
        expect(task?.body).toBe("Body line.");
    });
});

describe("closeTaskMd", () => {
    it("flips the status to done and appends the summary inside the section", () => {
        writeTasks(SAMPLE);
        closeTaskMd(dir, 6620, "## In plain English\nFixed the tooltip clipping.");
        const out = readTasks();
        expect(out).toContain("## 6620: Tooltip cuts off on limit column\n**Status:** done");
        const section = out.split("## 6645")[0];
        expect(section).toContain("Fixed the tooltip clipping.");
        // untouched neighbours
        expect(out).toContain("## 6630: BaseDialog should close on Esc\n**Status:** done");
        expect(out).toContain("## 6647: Users table sorting\n**Status:** open");
    });

    it("inserts a status line when the section had none", () => {
        writeTasks("## 7: No status here\n\nJust a body.\n");
        closeTaskMd(dir, 7, "done summary");
        const out = readTasks();
        expect(out).toContain("## 7: No status here\n**Status:** done");
        expect(out).toContain("done summary");
    });

    it("throws when the task number is not in the file", () => {
        writeTasks(SAMPLE);
        expect(() => closeTaskMd(dir, 999, "x")).toThrow(/999/);
    });
});

describe("flagForHumanMd", () => {
    it("flips the status to needs-human and appends the reason", () => {
        writeTasks(SAMPLE);
        flagForHumanMd(dir, 6647, "check failed");
        const out = readTasks();
        expect(out).toContain("## 6647: Users table sorting\n**Status:** needs-human");
        expect(out).toContain("check failed");
    });

    it("a flagged task is no longer selected", () => {
        writeTasks(SAMPLE);
        flagForHumanMd(dir, 6620, "stuck");
        expect(getNextTaskMd(dir)?.number).toBe(6647);
    });
});
