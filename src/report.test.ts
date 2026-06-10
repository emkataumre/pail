// src/report.test.ts
import { describe, it, expect } from "vitest";
import { summarize } from "./report";
import type { RunReport } from "./types";

describe("summarize", () => {
    it("renders a one-line outcome with counts and the stop reason", () => {
        const report: RunReport = {
            merged: [3, 5],
            needsHuman: [{ issue: 7, reason: "check stayed red" }],
            stoppedBy: "drained",
        };
        expect(summarize(report)).toBe("merged 2, needs-human 1 (drained)");
    });
});
