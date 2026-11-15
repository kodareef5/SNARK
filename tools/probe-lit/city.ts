// The far city on a GPU (client/core/render/farcity.ts), a check of tools/probe-lit.ts. A street of frame buildings from
// 250 m to 1.5 km off on medium, every box, lattice, the fade between the lattice and the mass, and the mass, drawn by runs
// of chunks with some of them held by the near store, is held to the software rasterizer pixel by pixel: the ranged
// draws, the tiles' vertices and the fade in as well as out.

import { tierOf } from "../../client/core/assets/tiers.ts";
import { CITY_SLOTS } from "../../client/core/render/farcity.ts";
import { CHUNK_SIZE } from "../../shared/coords.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import type { MapStatic } from "../../shared/world/mapfile.ts";
import { building, cityWorld, type CityWorld } from "../../tests/fixtures/cityworld.ts";
import { buildCorePack } from "../pack/build.ts";
import { PICK_FAR } from "../snap/raster.ts";
import { Shot, type LitCheck, type Readback } from "./shot.ts";

const [W, H] = [640, 360];
/** A channel within this many levels of the rasterizer's is the same colour, as in the far blocks' check. */
const SAME = 6;
const MOST_OFF = 0.01;
/** Where the camera stands, and the street's buildings along +x from it, a chunk apart and every other one a chunk aside. */
const AT = { x: 300, z: 2048 };
const FROM = 250;
const TO = 1500;

interface Held {
  frame: number;
  name: string;
  color: Uint8Array;
  kind: Uint8Array;
  id: Float64Array;
}

const made = { key: "", held: [] as Held[] };

function street(): MapStatic[] {
  const out: MapStatic[] = [];
  for (let d = FROM, k = 0; d <= TO; d += CHUNK_SIZE, k++) out.push(...building(AT.x + d + 32, AT.z + (k % 2 === 0 ? 40 : -40), 0, 4 + (k * 7) % 9, 2, (k * 3100) % 16384));
  return out;
}

/** The far city's pixels whose 3 by 3 neighbours are of one colour in the rasterizer: how many, and how many the GPU has more than SAME off. */
function compare(gpu: Uint8Array, h: Held): { n: number; bad: number; worst: number } {
  const out = { n: 0, bad: 0, worst: 0 };
  const off = (a: Uint8Array, b: Uint8Array, at: number, bt = at): number => Math.max(...[0, 1, 2].map((c) => Math.abs(a[at * 4 + c]! - b[bt * 4 + c]!)));
  for (let y = 1; y < H - 1; y++) {
    next: for (let x = 1; x < W - 1; x++) {
      const at = y * W + x;
      if (h.kind[at] !== PICK_FAR || h.id[at]! < CITY_SLOTS) continue;
      for (let dy = -W; dy <= W; dy += W) for (let dx = -1; dx <= 1; dx++) if (h.kind[at + dy + dx] !== PICK_FAR || off(h.color, h.color, at + dy + dx, at) > 2) continue next;
      const o = off(gpu, h.color, at);
      out.n++;
      if (o > SAME) out.bad++;
      out.worst = Math.max(out.worst, o);
    }
  }
  return out;
}

export const cityCheck: LitCheck = {
  name: "the far city (farcity.ts)",

  shots(): Shot[] {
    const bytes = buildCorePack();
    const w: CityWorld = cityWorld({ chunks: 64, statics: street(), tier: tierOf("medium"), width: W, height: H, pack: parsePack(bytes) });
    // The rasterizer draws no haze (D264), so these frames carry none.
    w.scene.plainSky = true;
    const shot = new Shot("city-medium", W, H, w.hf, bytes);
    made.key = shot.key;
    // Every frame goes to the GPU, so what each puts on the card is there for the next.
    const frame = (read: boolean): void => {
      w.scene.now += 1000 / 60;
      const p = w.scene.build(w.cam, null);
      w.raster.render(p);
      shot.add(p, read);
    };
    const hold = (name: string): void => {
      frame(false);
      frame(true);
      made.held.push({ frame: shot.frames.length - 1, name, color: Uint8Array.from(w.raster.color), kind: w.raster.pickKind.slice(), id: w.raster.pickId.slice() });
    };
    const look = (metres: number, up: number, fov: number): void => {
      w.cam.fovY = (fov * Math.PI) / 180;
      w.cam.x = AT.x;
      w.cam.z = AT.z;
      w.cam.y = w.hf.heightAt(AT.x, AT.z) + up;
      w.cam.yaw = Math.PI / 2;
      w.cam.pitch = Math.atan2(10 - up, metres);
    };
    w.scene.resetUploads();
    look(320, 10, 9);
    hold("the street's first buildings, every box, 250 to 400 m");
    look(650, 12, 9);
    hold("the lattice, 600 to 800 m");
    look(850, 15, 12);
    hold("the fade between the lattice and the mass, 810 to 900 m");
    look(1300, 20, 10);
    hold("the mass, 1.1 to 1.5 km");
    // The near store holds the street's first chunks: the tiles across it are drawn by runs of the others.
    for (let d = FROM; d < FROM + 3 * CHUNK_SIZE; d += CHUNK_SIZE) for (const side of [40, -40]) w.rows(w.chunkOf(AT.x + d + 32, AT.z + side));
    look(470, 12, 12);
    hold("the street's first chunks held near, the rest drawn by runs");
    return [shot];
  },

  judge(back: Readback) {
    const lines: string[] = [];
    let ok = true;
    for (const h of made.held) {
      const gpu = back.pixels(made.key, h.frame);
      if (!gpu) {
        lines.push(`${h.name}: NO PICTURE`);
        ok = false;
        continue;
      }
      const c = compare(gpu, h);
      const pass = c.n >= 200 && c.bad <= c.n * MOST_OFF;
      ok &&= pass;
      lines.push(`${h.name}: ${c.n - c.bad} of ${c.n} city pixels within ${SAME} of the rasterizer, the worst ${c.worst} off  ${pass ? "ok" : "FAIL"}`);
    }
    return { ok, lines };
  },
};
