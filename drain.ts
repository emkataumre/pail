// drain.ts — one trigger for Option C: run the bot to drain its afk pool, then auto-promote.
// Run from YOUR (operator) clone:  npx tsx drain.ts [botRemote]
// The bot subprocess stays push-disabled; the promotion happens here, with your credentials, the
// instant the drain finishes. (Post-merge re-sync is still manual — see promote.ts scope note.)
import { spawn } from "node:child_process";
import { run } from "./src/exec";
import { loadConfig } from "./src/config";
import { promote } from "./src/promote";
import { renderReport } from "./src/report";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function drainBot(botPath: string): Promise<number> {
    return new Promise((resolve) => {
        // Stream the bot's [pail] logs through live; it runs its own run.ts in its own clone.
        const child = spawn("npx", ["tsx", "run.ts"], { cwd: botPath, stdio: "inherit", shell: true });
        child.on("close", (code) => resolve(code ?? -1));
        child.on("error", () => resolve(-1));
    });
}

async function main() {
    const repoRoot = process.cwd();
    const botRemote = process.argv[2] ?? "bot";

    const url = await run("git", ["-C", repoRoot, "remote", "get-url", botRemote]);
    if (url.code !== 0) {
        throw new Error(`no '${botRemote}' remote in ${repoRoot}. Add it: git remote add ${botRemote} <path-to-bot-clone>`);
    }
    const botPath = url.stdout.trim();

    console.log(`[drain] draining the bot in ${botPath} ...`);
    const code = await drainBot(botPath);
    console.log(`[drain] bot exited (code ${code}); promoting ...`);

    // The bot persists its run report; render it as the promotion-PR body (falls back to the
    // default body if the file is missing — e.g. an older bot that didn't write one).
    let bodyOverride: string | undefined;
    try {
        bodyOverride = renderReport(JSON.parse(readFileSync(join(botPath, ".pail", "last-run-report.json"), "utf8")));
    } catch { /* no report file → promote uses its default body */ }

    const res = await promote(repoRoot, botRemote, loadConfig(botPath), undefined, bodyOverride);
    if (res.conflict) {
        console.error(`[drain] ${res.reason}`);
        process.exit(1);
    }
    if (!res.prUrl) {
        console.log(`[drain] ${res.reason ?? "nothing to promote"}.`);
        return;
    }
    console.log(`[drain] opened PR for #${res.merged.join(", #")}: ${res.prUrl}`);
}

main().catch((err) => {
    console.error(`[drain] fatal: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(2);
});
