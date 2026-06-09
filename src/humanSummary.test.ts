// src/humanSummary.test.ts
import { describe, it, expect } from "vitest";
import { formatSummary } from "./humanSummary";

describe("formatSummary", () => {
    it("renders the two-field header", () => {
        const out = formatSummary({ plainEnglish: "Learners can reset progress.", whyItMatters: "Real-user feature." });
        expect(out).toBe(
            "## In plain English\nLearners can reset progress.\n\n## Why it matters / who it affects\nReal-user feature.",
        );
    });

    it("appends technical detail under a divider when present", () => {
        const out = formatSummary({ plainEnglish: "X", whyItMatters: "Y", detail: "## What changed\nstuff" });
        expect(out).toContain("\n\n---\n## What changed\nstuff");
    });
});
