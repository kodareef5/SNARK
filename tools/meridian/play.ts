// Launch an isolated proving ground with a fully dressed survivor for browser review.
import { resolve } from "node:path";
import { startServer, DEV_CONFIG } from "../../server/main.ts";
import { loadConfigFolder } from "../../server/settings/config.ts";

const server = startServer({
  hostname: "127.0.0.1",
  port: Number(process.argv[3] ?? 8759),
  clientDir: resolve(process.argv[2] ?? "client/dist"),
  config: loadConfigFolder(DEV_CONFIG, []).rules,
  dev: true,
  probeScene: true,
  routes: (_request, url) => {
    if (url.pathname !== "/__look" || url.searchParams.get("view") !== "meridian") return null;
    return Response.json({ run: ["enablecheats", "settime 11", "armor meridian"], holdLook: false });
  },
});
console.log(`http://127.0.0.1:${server.port}/?quick&look=meridian`);
