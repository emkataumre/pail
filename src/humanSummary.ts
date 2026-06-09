// src/humanSummary.ts
export interface HumanSummary {
    plainEnglish: string;
    whyItMatters: string;
    detail?: string;
}

export function formatSummary(s: HumanSummary): string {
    const parts = [
        "## In plain English",
        s.plainEnglish.trim(),
        "",
        "## Why it matters / who it affects",
        s.whyItMatters.trim(),
    ];
    if (s.detail && s.detail.trim()) {
        parts.push("", "---", s.detail.trim());
    }
    return parts.join("\n");
}
