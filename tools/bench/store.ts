// Rows for the entity store of a server made as a real one is: createHost on a map file, with the settings' defaults. What
// a slot costs in memory, what a doubling costs the spawn it lands in, and whether a survivor still joins and a restart
// keeps every creature. `bun tools/bench/store.ts` runs these alone.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClientSession } from "../../client/core/session.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { contentFor, createHost, type Host } from "../../server/host.ts";
import { Rules } from "../../server/settings/rules.ts";
import { ENTITY_START } from "../../server/world.ts";
import { defaultLook } from "../../shared/anim/look.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { LoopbackNet } from "../../shared/net/loopback.ts";
import { KEY_BYTES } from "../../shared/net/protocol.ts";
import { Rng } from "../../shared/rng.ts";
import { F_PROP } from "../../shared/sim/entities.ts";
import { mapHeightfield, parseMap } from "../../shared/world/mapfile.ts";

type Section = (title: string) => void;
type Row = (name: string, value: number, unit: string, budget?: number | null) => void;

const CREATURES = 20000;

/** Bytes in the typed columns of `of`. */
function columnBytes(of: object): number {
  let bytes = 0;
  for (const col of Object.values(of)) if (ArrayBuffer.isView(col)) bytes += col.byteLength;
  return bytes;
}

/** A map's entry from a number to something, as Bun 1.4.3 keeps a million of them. */
const MAP_ENTRY = 55;

/**
 * What one slot takes: the store's columns, its vehicle rows among them, an entry for each name, look and gear a slot has,
 * and the columns kept beside the store by the creatures, their minds and the history (four bytes there).
 */
function slotBytes(host: Host): number {
  const ents = host.world.ents;
  const beside = columnBytes(host.creatures.mind) + columnBytes(host.creatures) + ents.cap * 4;
  const entries = (ents.names.size + ents.looks.size + ents.gears.size) * MAP_ENTRY;
  return (columnBytes(ents) - ents.chunkHead.byteLength + entries + beside) / ents.cap;
}

export function storeRows(section: Section, record: Row): void {
  section(`Entity store: a default server filled past its first ${ENTITY_START} slots, then to the most its settings allow`);
  const reg = contentFor(compileContent(CORE_CONTENT).registry!, new Rules());
  const dir = mkdtempSync(join(tmpdir(), "snark-bench-store-"));
  const dbPath = join(dir, "world.db");
  const host = createHost(reg, { dbPath });
  const ents = host.world.ents;
  const rng = new Rng(41);
  // A corner of the proving ground four chunks from its spawn point, so they sleep when a survivor joins.
  const doublings: number[] = [];
  let t0 = performance.now();
  for (let n = 0; n < CREATURES; ) {
    const cap = ents.cap;
    const t = performance.now();
    const e = host.spawnCreature("core:grazer", rng.range(8, 60), rng.range(8, 60), 1 + rng.int(150));
    if (ents.cap !== cap) doublings.push(performance.now() - t);
    if (e >= 0) n++;
  }
  record(`spawn ${CREATURES} creatures with genomes, the store doubling as they come`, performance.now() - t0, "ms");
  record("slots the store has after them", ents.cap, "");
  record("the slowest spawn with a doubling in it", Math.max(...doublings), "ms", 16);
  record("memory a slot takes, with the columns kept beside the store", slotBytes(host), "bytes", 200);

  // A survivor joins the world that has outgrown its first slots.
  const hf = mapHeightfield(parseMap(host.mapFile!));
  const net = new LoopbackNet(3);
  host.game.listen(net);
  const session = new ClientSession(net.connect(), { name: "bot0", key: new Uint8Array(KEY_BYTES).fill(1), registry: reg, look: defaultLook(), resolveMap: () => hf });
  for (let i = 1; i <= 90; i++) {
    net.advance((i * 1000) / TICK_RATE);
    host.game.tick();
    session.update((i * 1000) / TICK_RATE, 0, 1, i / 40, 0, 0);
  }
  record("survivors turned away from it, of 1", session.state === "active" ? 0 : 1, "", 0);
  record("bodies the store refused", ents.refused, "", 0);
  session.close();
  host.shutdown();

  t0 = performance.now();
  const again = createHost(reg, { dbPath });
  record(`start a host on that save, and give ${CREATURES} creatures their bodies`, performance.now() - t0, "ms");
  let bodiless = 0;
  for (const rec of again.records.byPid.values()) if (reg.defs[rec.kind]?.type === "species" && rec.keyHash === null && !again.records.entOf.has(rec.pid)) bodiless++;
  record("creatures of the save left without a body", bodiless, "", 0);
  again.shutdown();
  rmSync(dir, { recursive: true, force: true });

  // The rest of the way to the settings' limit, with things that have no record: what the largest doublings cost.
  const full = createHost(reg);
  const store = full.world.ents;
  const rest: number[] = [];
  t0 = performance.now();
  for (;;) {
    const cap = store.cap;
    const t = performance.now();
    if (store.create(1, rng.range(8, 60), 0, rng.range(8, 60), F_PROP) < 0) break;
    if (store.cap !== cap) rest.push(performance.now() - t);
  }
  record(`fill a store to MaxEntities, ${store.max} less the ${store.reserve} places kept for survivors`, performance.now() - t0, "ms");
  record("doublings on the way", rest.length, "");
  // Three ticks. It happens once, when the world's 262,145th body is made.
  record(`the last doubling, to ${store.cap} slots`, rest[rest.length - 1]!, "ms", 100);
  record("memory the full store and the columns beside it take", (slotBytes(full) * store.cap) / 1048576, "MB", 128);
}

if (import.meta.main) {
  let missed = false;
  storeRows(
    (title) => console.log(`\n${title}`),
    (name, value, unit, budget = null) => {
      const verdict = budget === null ? "" : value <= budget ? `  ok (budget ${budget})` : `  MISS (budget ${budget})`;
      if (verdict.includes("MISS")) missed = true;
      console.log(`  ${name.padEnd(58)} ${value.toFixed(value < 10 ? 3 : 1).padStart(12)} ${unit}${verdict}`);
    },
  );
  if (missed) process.exit(1);
}
