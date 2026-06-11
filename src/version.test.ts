// src/version.test.ts
import { describe, it, expect } from "vitest";
import { PAIL_VERSION } from "./version";

describe("PAIL_VERSION", () => {
    it("reports the current version", () => {
        expect(PAIL_VERSION).toBe("0.1.0");
    });
});
