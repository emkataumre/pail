// src/report.test.ts
import { describe, it, expect } from "vitest";
import { summarize } from "./report";
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
