// Development server: builds the client, starts the world, rebuilds the client
// when client or shared sources change. Restart it for server changes
// (`bun --watch tools/dev.ts` does that automatically).
//
//   bun run dev

import { watch } from "node:fs";
import { resolve } from "node:path";
import { startServer } from "../server/main.ts";
import { buildClient } from "./build-client.ts";

const root = resolve(import.meta.dir, "..");
await buildClient();
const server = startServer({ dev: true, port: Number(process.env.PORT ?? 8787) });
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
