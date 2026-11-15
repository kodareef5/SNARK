// Development server. It rebuilds the client when client, shared or content sources change. Restart it for
// server changes, or run `bun --watch tools/dev.ts`. Its cheats need no password, so it listens on this machine only:
// `--host 0.0.0.0` has it listen on every address, for a phone or another machine on the network.

import { watch } from "node:fs";
import { resolve } from "node:path";
import { DEV_CONFIG, liveFileOf, startServer } from "../server/main.ts";
import { formatReport, loadConfigFolder } from "../server/settings/config.ts";
import { buildClient } from "./build-client.ts";

const root = resolve(import.meta.dir, "..");
/** With --stress the stress meshes are built in, and the page at ?stress=1 draws them. */
const stress = process.argv.includes("--stress");
await buildClient({ stress, quick: true });
// Settings come from DEV_CONFIG or the folder named after --config, then from ARK-style command-line arguments.
const args = process.argv.slice(2);
const named = args.indexOf("--config");
const folder = named >= 0 && args[named + 1] ? args[named + 1]! : DEV_CONFIG;
const { rules, report } = loadConfigFolder(folder, args);
for (const line of formatReport(report, rules)) console.log(line);
const live = liveFileOf(folder);
const host = args.indexOf("--host");
const hostname = host >= 0 ? args[host + 1] : undefined;
const server = startServer({ dev: true, port: Number(process.env.PORT ?? 8787), config: rules, ...(hostname ? { hostname } : {}), ...(live ? { live } : {}) });
console.log(`SNARK dev: http://localhost:${server.port}   (self-check: http://localhost:${server.port}/?selfcheck=1)`);
if (!hostname) console.log("  this machine only; --host 0.0.0.0 lets others on the network in, and they need no password to cheat");

let pending: ReturnType<typeof setTimeout> | undefined;
for (const dir of ["client/core", "client/shell", "client/voice", "client/assets", "client/sound", "shared", "content"]) {
  watch(resolve(root, dir), { recursive: true }, () => {
    clearTimeout(pending);
    pending = setTimeout(() => {
      buildClient({ stress, quick: true }).then(
        (r) => console.log(`client rebuilt (${r.jsBytes} bytes)`),
        (err) => console.error(String(err)),
      );
    }, 80);
  });
}
