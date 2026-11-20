// The mock world on a WebSocket, in real time: `bun tools/grunt/serve.ts [--port 8771] [--scene file.json]`.
// One character; the grunt endpoint is ws://127.0.0.1:<port>/grunt. Typed lines are said to the character, as another
// player in local chat would ("Ana: come here"), and `where` prints where the character is.

import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { GameEndpoint } from "./game.ts";
import { BEACH, makeWorld, type Scene } from "./scenes.ts";
import { TICK_MS } from "./world.ts";

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const port = Number(arg("--port") ?? 8771);
const sceneFile = arg("--scene");
const scene: Scene = sceneFile ? (JSON.parse(readFileSync(sceneFile, "utf8")).world ?? JSON.parse(readFileSync(sceneFile, "utf8"))) : BEACH;
const world = makeWorld(scene);
const game = new GameEndpoint(world);

type Socket = { send(s: string): void; data: { conn?: ReturnType<GameEndpoint["connect"]> } };
const server = Bun.serve<{ conn?: ReturnType<GameEndpoint["connect"]> }, undefined>({
  hostname: "127.0.0.1",
  port,
  fetch(req, srv) {
    if (new URL(req.url).pathname === "/grunt" && srv.upgrade(req, { data: {} })) return undefined;
    return new Response("the mock grunt world: ws://…/grunt\n");
  },
  websocket: {
    open(ws: Socket) {
      ws.data.conn = game.connect((m) => ws.send(JSON.stringify(m)));
    },
    message(ws: Socket, msg: string | Buffer) {
      ws.data.conn?.receive(typeof msg === "string" ? msg : msg.toString());
    },
    close(ws: Socket) {
      ws.data.conn?.close();
    },
  },
});
setInterval(() => {
  world.step();
  game.afterStep();
}, TICK_MS);
console.log(`mock grunt world on ws://127.0.0.1:${server.port}/grunt`);

createInterface({ input: process.stdin }).on("line", (line) => {
  if (line.trim() === "where") {
    const m = world.me;
    console.log(`${m.name} at ${m.x.toFixed(1)}, ${m.z.toFixed(1)} facing ${m.yaw.toFixed(2)}, health ${m.health}, ${m.slots.map((s) => `${s.item}×${s.count}`).join(" ")}`);
    return;
  }
  const at = line.indexOf(":");
  if (at > 0) world.say(line.slice(0, at).trim(), line.slice(at + 1).trim());
});
