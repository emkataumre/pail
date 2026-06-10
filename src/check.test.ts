// src/check.test.ts
import { describe, it, expect } from "vitest";
import { runCheck } from "./check";
import type { Config } from "./types";

const NODE = process.execPath;
function cfg(checkCommand: string, checkTimeoutMs = 5000): Config {
    return { checkCommand, checkTimeoutMs } as Config;
}

describe("runCheck", () => {
    it("is green on exit 0", async () => {
        const r = await runCheck(process.cwd(), cfg(`"${NODE}" -e "process.exit(0)"`));
        expect(r).toMatchObject({ green: true, timedOut: false });
    });

    it("is not green on exit 1", async () => {
        const r = await runCheck(process.cwd(), cfg(`"${NODE}" -e "process.exit(1)"`));
        expect(r.green).toBe(false);
        expect(r.timedOut).toBe(false);
    });

    it("treats a hang as not-green and flags the timeout", async () => {
        const r = await runCheck(process.cwd(), cfg(`"${NODE}" -e "setInterval(()=>{},1000)"`, 400));
        expect(r).toMatchObject({ green: false, timedOut: true });
    });

    it("captures the command's combined stdout and stderr output", async () => {
        const r = await runCheck(
            process.cwd(),
            cfg(`"${NODE}" -e "console.log('hello-stdout'); console.error('oops-stderr'); process.exit(1)"`),
        );
        expect(r.green).toBe(false);
        expect(r.output).toContain("hello-stdout");
        expect(r.output).toContain("oops-stderr");
    });
});
