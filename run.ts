// run.ts
import { main } from "./src/run";

main(process.cwd())
    .then((code) => process.exit(code))
    .catch((err) => {
        console.error(`[pail] fatal: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(2);
    });
