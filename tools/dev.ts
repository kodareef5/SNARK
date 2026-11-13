// Development server: builds the client, starts the world, rebuilds the client
// when client or shared sources change. Restart it for server changes
// (`bun --watch tools/dev.ts` does that automatically).
//
//   bun run dev

import { watch } from "node:fs";
import { resolve } from "node:path";
import { DEV_CONFIG, liveFileOf, startServer } from "../server/main.ts";
import { formatReport, loadConfigFolder } from "../server/settings/config.ts";
import { buildClient } from "./build-client.ts";

const root = resolve(import.meta.dir, "..");
await buildClient();
// A development server's settings: its own folder, or the one named after `--config`; then anything given ARK's way on the command line.
const args = process.argv.slice(2);
const named = args.indexOf("--config");
const folder = named >= 0 && args[named + 1] ? args[named + 1]! : DEV_CONFIG;
const { rules, report } = loadConfigFolder(folder, args);
for (const line of formatReport(report, rules)) console.log(line);
const live = liveFileOf(folder);
const server = startServer({ dev: true, port: Number(process.env.PORT ?? 8787), config: rules, ...(live ? { live } : {}) });
console.log(`SNARK dev: http://localhost:${server.port}   (self-check: http://localhost:${server.port}/?selfcheck=1)`);

let pending: ReturnType<typeof setTimeout> | undefined;
for (const dir of ["client/core", "client/shell", "client/voice", "shared", "content"]) {
  watch(resolve(root, dir), { recursive: true }, () => {
    clearTimeout(pending);
    pending = setTimeout(() => {
      buildClient().then(
        (r) => console.log(`client rebuilt (${r.jsBytes} bytes)`),
        (err) => console.error(String(err)),
      );
    }, 80);
  });
}
