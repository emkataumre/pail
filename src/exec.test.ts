// src/exec.test.ts
import { describe, it, expect } from "vitest";
import { run } from "./exec";

const NODE = process.execPath;

describe("run", () => {
    it("captures stdout and a zero exit code", async () => {
        const res = await run(NODE, ["-e", "process.stdout.write('hello')"]);
        expect(res.code).toBe(0);
        expect(res.stdout).toBe("hello");
        expect(res.timedOut).toBe(false);
    });

    it("reports a non-zero exit code", async () => {
        const res = await run(NODE, ["-e", "process.exit(3)"]);
        expect(res.code).toBe(3);
    });

    it("times out a hanging process and flags timedOut", async () => {
        const res = await run(NODE, ["-e", "setInterval(()=>{}, 1000)"], { timeoutMs: 400 });
        expect(res.timedOut).toBe(true);
        expect(res.code).not.toBe(0);
    });
});
