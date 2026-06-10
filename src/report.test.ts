// src/report.test.ts
import { describe, it, expect } from "vitest";
import { summarize, renderReport } from "./report";
import type { RunReport } from "./types";

describe("summarize", () => {
    it("names the needs-human issue numbers in brackets", () => {
        const report: RunReport = {
            merged: [3, 5],
            needsHuman: [{ issue: 7, reason: "check stayed red" }],
            stoppedBy: "drained",
        };
        expect(summarize(report)).toBe("merged 2, needs-human 1 [#7] (drained)");
    });

    it("lists every needs-human issue number", () => {
        const report: RunReport = {
            merged: [],
            needsHuman: [
                { issue: 42, reason: "check stayed red" },
                { issue: 43, reason: "agent gave up" },
            ],
            stoppedBy: "circuitBreaker",
        };
        expect(summarize(report)).toBe("merged 0, needs-human 2 [#42 #43] (circuitBreaker)");
    });

    it("omits the brackets when nothing needs a human", () => {
        const report: RunReport = {
            merged: [3, 5],
            needsHuman: [],
            stoppedBy: "drained",
        };
        expect(summarize(report)).toBe("merged 2, needs-human 0 (drained)");
    });
});

describe("renderReport", () => {
    it("falls back to the flat summary when there is no enriched per-task data", () => {
        const report: RunReport = {
            merged: [3, 5],
            needsHuman: [{ issue: 7, reason: "check stayed red" }],
            stoppedBy: "drained",
        };
        expect(renderReport(report)).toBe(summarize(report));
    });

    it("falls back to the flat summary when the tasks array is empty", () => {
        const report: RunReport = {
            merged: [],
            needsHuman: [],
            stoppedBy: "drained",
            tasks: [],
        };
        expect(renderReport(report)).toBe(summarize(report));
    });

    it("leads with a header summary line and renders one line per slice", () => {
        const report: RunReport = {
            merged: [5],
            needsHuman: [{ issue: 7, reason: "check stayed red" }],
            stoppedBy: "drained",
            tasks: [
                { number: 5, title: "Parse acceptance", status: "merged", acceptance: "passed", diffstat: "+40 -2" },
                { number: 7, title: "Run acceptance", status: "needs-human", reason: "check stayed red", acceptance: "na", diffstat: "+0 -0" },
            ],
        };
        expect(renderReport(report)).toBe(
            [
                "merged 1, needs-human 1 [#7] (drained)",
                "",
                "- #5 Parse acceptance · merged · acceptance passed · +40 -2",
                "- #7 Run acceptance · needs-human · no acceptance · +0 -0",
                "",
                "## Needs human",
                "- #7 Run acceptance — check stayed red",
            ].join("\n"),
        );
    });

    it("renders the three acceptance results as passed / failed / no acceptance", () => {
        const report: RunReport = {
            merged: [1, 2],
            needsHuman: [],
            stoppedBy: "drained",
            tasks: [
                { number: 1, title: "A", status: "merged", acceptance: "passed", diffstat: "+1 -0" },
                { number: 2, title: "B", status: "merged", acceptance: "failed", diffstat: "+2 -0" },
                { number: 3, title: "C", status: "merged", acceptance: "na", diffstat: "+3 -0" },
            ],
        };
        const out = renderReport(report);
        expect(out).toContain("- #1 A · merged · acceptance passed · +1 -0");
        expect(out).toContain("- #2 B · merged · acceptance failed · +2 -0");
        expect(out).toContain("- #3 C · merged · no acceptance · +3 -0");
    });

    it("groups slices by Parent: #N when they carry a parent reference", () => {
        const report: RunReport = {
            merged: [13, 14, 21],
            needsHuman: [],
            stoppedBy: "drained",
            tasks: [
                { number: 13, title: "Parse", status: "merged", acceptance: "passed", diffstat: "+10 -0", parent: 12 },
                { number: 14, title: "Execute", status: "merged", acceptance: "passed", diffstat: "+20 -1", parent: 12 },
                { number: 21, title: "Predicate", status: "merged", acceptance: "failed", diffstat: "+5 -0", parent: 20 },
            ],
        };
        expect(renderReport(report)).toBe(
            [
                "merged 3, needs-human 0 (drained)",
                "",
                "## Parent: #12",
                "- #13 Parse · merged · acceptance passed · +10 -0",
                "- #14 Execute · merged · acceptance passed · +20 -1",
                "",
                "## Parent: #20",
                "- #21 Predicate · merged · acceptance failed · +5 -0",
            ].join("\n"),
        );
    });

    it("lists parentless slices flat before the parent groups when both are present", () => {
        const report: RunReport = {
            merged: [9, 13],
            needsHuman: [],
            stoppedBy: "drained",
            tasks: [
                { number: 9, title: "Loose", status: "merged", acceptance: "na", diffstat: "+1 -0" },
                { number: 13, title: "Parse", status: "merged", acceptance: "passed", diffstat: "+10 -0", parent: 12 },
            ],
        };
        expect(renderReport(report)).toBe(
            [
                "merged 2, needs-human 0 (drained)",
                "",
                "- #9 Loose · merged · no acceptance · +1 -0",
                "",
                "## Parent: #12",
                "- #13 Parse · merged · acceptance passed · +10 -0",
            ].join("\n"),
        );
    });

    it("lists every flagged slice with its reason in a needs-human section", () => {
        const report: RunReport = {
            merged: [],
            needsHuman: [
                { issue: 42, reason: "check stayed red" },
                { issue: 43, reason: "merge conflict" },
            ],
            stoppedBy: "circuitBreaker",
            tasks: [
                { number: 42, title: "First", status: "needs-human", reason: "check stayed red", acceptance: "na", diffstat: "+0 -0" },
                { number: 43, title: "Second", status: "needs-human", reason: "merge conflict", acceptance: "na", diffstat: "+0 -0" },
            ],
        };
        const out = renderReport(report);
        expect(out).toContain("## Needs human");
        expect(out).toContain("- #42 First — check stayed red");
        expect(out).toContain("- #43 Second — merge conflict");
    });

    it("omits the needs-human section when nothing is flagged", () => {
        const report: RunReport = {
            merged: [5],
            needsHuman: [],
            stoppedBy: "drained",
            tasks: [
                { number: 5, title: "Only", status: "merged", acceptance: "passed", diffstat: "+1 -0" },
            ],
        };
        expect(renderReport(report)).not.toContain("Needs human");
    });
});
