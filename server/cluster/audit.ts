// Whether a cluster balances: across every save of it and its folder, for every item, what was made less what was destroyed is
// what the worlds hold plus what is on its way, and every departure is matched by one arrival or one file. Each save is read as
// it was at its last commit, while its server runs; what was done since is in the next look.

import type { Registry } from "../../shared/content/registry.ts";
import { readSave, TRANSFER_IN, TRANSFER_OUT, type SaveView } from "../persist/store.ts";
import type { ClusterFolder, ParcelPlace } from "./folder.ts";
import { openParcel, type ParcelHead } from "./parcel.ts";

export interface Audit {
  ok: boolean;
  lines: string[];
}

/** Items by content id. */
type Counts = Map<string, number>;

function add(to: Counts, id: string, n: number): void {
  if (n !== 0) to.set(id, (to.get(id) ?? 0) + n);
}

/** Looks again while transfers move under it, up to a few times, so that the saves and the folder are read as of one moment. */
export function auditCluster(folder: ClusterFolder, reg: Registry): Audit {
  for (let tries = 0; ; tries++) {
    const before = listing(folder.places());
    const result = look(folder, reg);
    if (listing(folder.places()) === before || tries >= 4) return result;
  }
}

function listing(places: readonly ParcelPlace[]): string {
  return places.map((p) => p.file).sort().join("\n");
}

function look(folder: ClusterFolder, reg: Registry): Audit {
  const lines: string[] = [];
  let ok = true;
  const wrong = (line: string): void => {
    ok = false;
    lines.push(line);
  };
  const saves = new Map<number, SaveView>();
  for (const a of folder.announcements()) {
    if (a.save === "") continue;
    try {
      saves.set(a.world, readSave(a.save, reg));
    } catch (err) {
      // A world whose save never committed holds nothing yet.
      if (a.at === 0 && a.map === "") continue;
      wrong(`world ${a.world} (${a.name || a.map || a.save}): its save cannot be read: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  // What each world made and destroyed of its own, what it holds, and the transfers its save records.
  const made: Counts = new Map();
  const held: Counts = new Map();
  const known = new Set<string>();
  for (const [world, save] of saves) {
    const own: Counts = new Map();
    for (const rec of save.records) {
      const inv = rec.inv;
      for (let s = 0; inv && s < inv.cap; s++) {
        if (inv.item[s] === 0) continue;
        add(own, reg.ids[inv.item[s]!]!, inv.count[s]!);
        if (inv.loaded[s]! > 0) add(own, reg.ids[inv.ammo[s]!]!, inv.loaded[s]!);
        if (inv.attach[s] !== 0) add(own, reg.ids[inv.attach[s]!]!, 1);
      }
    }
    const ledger = save.ledger ? (JSON.parse(save.ledger) as Record<string, number[]>) : {};
    for (const id of new Set([...own.keys(), ...Object.keys(ledger)])) {
      const [minted = 0, burned = 0, received = 0, sent = 0] = ledger[id] ?? [];
      if ((own.get(id) ?? 0) !== minted - burned) wrong(`world ${world}: holds ${own.get(id) ?? 0} of ${id}, and its ledger says ${minted - burned}`);
      add(made, id, minted - received - (burned - sent));
      add(held, id, own.get(id) ?? 0);
    }
    for (const t of save.transfers) known.add(`${world}/${t.id}/${t.dir}`);
  }
  // Every transfer file: on its way, arrived, or not yet given up by the world it left.
  const transit: Counts = new Map();
  const files = new Set<string>();
  let moving = 0;
  for (const place of folder.places()) {
    const bytes = folder.read(place);
    let head: ParcelHead;
    try {
      if (!bytes) continue;
      head = openParcel(bytes).head;
    } catch (err) {
      wrong(`transfer ${place.id}: its file cannot be read: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    files.add(`${head.from}/${head.id}/${TRANSFER_OUT}`);
    if (place.by !== 0) files.add(`${place.by}/${head.id}/${TRANSFER_IN}`);
    const left = known.has(`${head.from}/${head.id}/${TRANSFER_OUT}`);
    const came = place.by !== 0 && known.has(`${place.by}/${head.id}/${TRANSFER_IN}`);
    if (left && !came) {
      moving++;
      for (const [id, n] of Object.entries(head.items)) add(transit, id, n);
    }
    if (came && !left) wrong(`${head.name} is in world ${place.by} by transfer ${head.id}, and world ${head.from} has not given it up yet: it will when it next starts`);
  }
  for (const key of known) {
    if (files.has(key)) continue;
    const [world, id, dir] = key.split("/");
    wrong(`world ${world} records that transfer ${id} ${Number(dir) === TRANSFER_IN ? "came" : "left"}, and the folder has no file of it ${Number(dir) === TRANSFER_IN ? "taken there" : "from there"}`);
  }
  for (const id of new Set([...made.keys(), ...held.keys(), ...transit.keys()])) {
    const m = made.get(id) ?? 0;
    const h = (held.get(id) ?? 0) + (transit.get(id) ?? 0);
    if (m !== h) wrong(`${id}: ${m} made less destroyed, and ${h} held or on the way`);
  }
  if (ok) lines.push(`the cluster balances: ${saves.size} ${saves.size === 1 ? "world" : "worlds"}, ${known.size} transfers recorded, ${moving} on the way`);
  return { ok, lines };
}
