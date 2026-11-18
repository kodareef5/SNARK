// Open the local Miami build at an authored camera and return control to the player.
// bun tools/mapworld/tide-eye-review.ts [map.snmap] [built-client] [port] [review.db]
// For matching stills run tools/mapworld/gpu-views.ts with assets/source/maps/miami/look/tide-eye.json.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DEV_CONFIG, startServer } from "../../server/main.ts";
import { loadConfigFolder } from "../../server/settings/config.ts";
interface ReviewCamera {
  name: string; x: number; z: number; y?: number; up?: number; look: [number, number, number];
}
const cameras: { hour: number; views: ReviewCamera[] } = JSON.parse(readFileSync(resolve(import.meta.dir, "../../assets/source/maps/miami/look/tide-eye.json"), "utf8"));

const [map = "var/maps/miami.snmap", dist = "client/dist", port = "8817", db = "var/tide-eye-review.db"] = process.argv.slice(2);
const byName = new Map(cameras.views.map(view => [view.name, view]));
// Catch a missing build before opening the review address.
readFileSync(resolve(dist, "index.html"), "utf8");
const server = startServer({
  hostname: "127.0.0.1", port: Number(port), dev: true, dbPath: db, map, clientDir: resolve(dist),
  config: loadConfigFolder(DEV_CONFIG, []).rules,
  routes: (_req, url) => {
    if (url.pathname !== "/__look") return null;
    const view = byName.get(url.searchParams.get("view") ?? "");
    if (!view) return new Response("Unknown camera", { status: 404 });
    const hf = server.host.world.hf;
    const ground = (x: number, z: number) => Math.max(hf.seaLevel, hf.heightAt(x, z));
    const y = view.y ?? ground(view.x, view.z) + (view.up ?? 1.7);
    const [x, z, h] = view.look;
    const look = [Math.atan2(x - view.x, z - view.z), Math.atan2(ground(x, z) + h - y, Math.hypot(x - view.x, z - view.z))];
    const onFoot = view.name === "blue-deck";
    return Response.json({
      run: ["enablecheats", onFoot ? "walk" : "fly", `tp ${view.x} ${y - 1.62} ${view.z}`, `settime ${cameras.hour}`],
      look, holdLook: false,
      ...(view.name === "bayfront-ignition" ? { eyeSeconds: 5, playEye: true } : {}),
    });
  },
});
console.log(`Tide Eye review at http://127.0.0.1:${server.port}/?quick&look=blue-crown`);
