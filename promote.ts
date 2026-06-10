// promote.ts — operator-side entry for Option C. Run from YOUR clone after a bot drain:
//   npx tsx promote.ts            (uses the "bot" remote)
//   npx tsx promote.ts <remote>   (custom remote name)
// The bot stays push-disabled; this opens the review PR with your credentials. Assumes the bot clone
// is local (the "<remote>" points at its path) so its .pail/config.json can be read for branch names.
import { run } from "./src/exec";
import { loadConfig } from "./src/config";
import { promote } from "./src/promote";

async function main() {
    const repoRoot = process.cwd();
    const botRemote = process.argv[2] ?? "bot";

    const url = await run("git", ["-C", repoRoot, "remote", "get-url", botRemote]);
    if (url.code !== 0) {
        throw new Error(`no '${botRemote}' remote in ${repoRoot}. Add it: git remote add ${botRemote} <path-to-bot-clone>`);
    }
    const cfg = loadConfig(url.stdout.trim());

    const res = await promote(repoRoot, botRemote, cfg);
    if (res.conflict) {
        console.error(`[pail-promote] ${res.reason}`);
        process.exit(1);
    }
    if (!res.prUrl) {
        console.log(`[pail-promote] ${res.reason ?? "nothing to promote"}.`);
        return;
    }
    console.log(`[pail-promote] opened PR for #${res.merged.join(", #")}: ${res.prUrl}`);
}

main().catch((err) => {
    console.error(`[pail-promote] fatal: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(2);
});
