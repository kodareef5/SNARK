// What building and the world's nodes are heard doing, from the structure rows and used-up nodes the client is sent
// (ClientSession.onStructure, onNode): a piece placed, struck, mended, destroyed, brought down or taken up; a door
// opening or shutting and a fire lit or put out (each a swap of kinds in the same slot); a tree felled, a rock broken,
// a bush stripped. Lit fires near the ear crackle while they burn. Each piece is heard by its own sounds where it has
// them, else by its material's (the `{tier}` of shared/sound/cues.ts).

import type { Registry } from "../../../shared/content/registry.ts";
import { cueKey } from "../../../shared/sound/cues.ts";
import { GONE_DESTROYED, GONE_FELL, GONE_TAKEN } from "../../../shared/world/structures.ts";
import type { Hear } from "./bodies.ts";

const TIERS = ["thatch", "wood", "stone", "metal"];
const by = (f: (t: string) => string): number[] => TIERS.map((t) => cueKey(f(t)));
const PLACE = by((t) => `place/${t}`);
const DESTROY = by((t) => `destroy/${t}`);
const HIT = by((t) => `hit/${t}`);
const K = {
  collapse: cueKey("collapse"),
  demolish: cueKey("demolish"),
  repair: cueKey("repair"),
  openWood: cueKey("door/open/wood"),
  openMetal: cueKey("door/open/metal"),
  closeWood: cueKey("door/close/wood"),
  closeMetal: cueKey("door/close/metal"),
  light: cueKey("fire/light"),
  out: cueKey("fire/out"),
  burn: cueKey("fire/burn"),
  felled: cueKey("felled"),
  crumble: cueKey("crumble"),
  picked: cueKey("picked"),
};
/** Metres within which a lit fire is heard burning, and how many at most. */
const FIRE_REACH = 20;
const FIRES = 3;

export class BuildSounds {
  private readonly reg: Registry;
  /** By structure kind: its tier (an index of TIERS), its owner number, and whether it is a door (1) or a fire (2). */
  private readonly tier: Int8Array;
  private readonly owner: Int32Array;
  private readonly role: Uint8Array;
  /** By node kind: its owner number and what using it up sounds like. */
  private readonly nodeOwner: Int32Array;
  private readonly nodeKey: Int32Array;
  /** Lit fires known, by place. */
  readonly fires = new Map<string, { x: number; y: number; z: number }>();
  private readonly queue: (() => void)[] = [];

  constructor(reg: Registry, ownerOf: (id: string) => number) {
    this.reg = reg;
    const n = reg.defs.length;
    this.tier = new Int8Array(n).fill(2);
    this.owner = new Int32Array(n).fill(-1);
    this.role = new Uint8Array(n);
    this.nodeOwner = new Int32Array(n).fill(-1);
    this.nodeKey = new Int32Array(n).fill(-1);
    reg.defs.forEach((d, kind) => {
      if (!d) return;
      if (d.type === "structure") {
        const m = (d as { material?: string }).material;
        const t = m ? TIERS.indexOf(m.slice(m.lastIndexOf(":") + 1).replace(/^mat_/, "")) : -1;
        this.tier[kind] = t >= 0 ? t : 2;
        this.owner[kind] = ownerOf(d.id);
        this.role[kind] = reg.opens[kind] !== 0 ? 1 : reg.lights[kind] !== 0 ? 2 : 0;
      } else if (d.type === "node") {
        const m = (d as { material?: string }).material;
        this.nodeOwner[kind] = ownerOf(d.id);
        this.nodeKey[kind] = m === "wood" ? K.felled : m === "stone" ? K.crumble : K.picked;
      }
    });
  }

  /** A structure row changed (ClientSession.onStructure). Heard on the next frame. */
  structure(was: number, kind: number, x: number, y: number, z: number, hpWas: number, hp: number, cause: number): void {
    this.queue.push(() => this.heardStructure(was, kind, x, y, z, hpWas, hp, cause));
  }

  /** A node used up (ClientSession.onNode), of `kind` at (x, y, z). */
  node(kind: number, x: number, y: number, z: number): void {
    this.queue.push(() => this.heardNode(kind, x, y, z));
  }

  private hear: Hear | null = null;

  /** One frame: what changed since the last, heard; and the fires near (ex, ey, ez) held burning through `burn`. */
  update(ex: number, ey: number, ez: number, hear: Hear, burn: (id: number, owner: number, key: number, x: number, y: number, z: number, on: boolean) => void): void {
    this.hear = hear;
    for (const f of this.queue) f();
    this.queue.length = 0;
    const near = [...this.fires.entries()].map(([k, f]) => ({ k, f, d: Math.hypot(f.x - ex, f.y - ey, f.z - ez) })).filter((e) => e.d < FIRE_REACH).sort((a, b) => a.d - b.d);
    for (let i = 0; i < FIRES; i++) {
      const e = near[i];
      burn(i, 0, K.burn, e?.f.x ?? 0, e?.f.y ?? 0, e?.f.z ?? 0, e !== undefined);
    }
  }

  private heardStructure(was: number, kind: number, x: number, y: number, z: number, hpWas: number, hp: number, cause: number): void {
    const hear = this.hear!;
    const reg = this.reg;
    const at = `${Math.round(x * 4)},${Math.round(y * 4)},${Math.round(z * 4)}`;
    if (kind === 0) {
      this.fires.delete(at);
      const o = this.owner[was]!;
      const t = this.tier[was]!;
      if (cause === GONE_DESTROYED) hear(o, DESTROY[t]!, -1, x, y, z, 0.5, 1, false);
      else if (cause === GONE_FELL) hear(o, K.collapse, -1, x, y, z, 0.5, 0.7, false);
      else if (cause === GONE_TAKEN) hear(o, K.demolish, -1, x, y, z, 0.5, 0.9, false);
      return;
    }
    const o = this.owner[kind]!;
    const t = this.tier[kind]!;
    if (was === 0) {
      hear(o, PLACE[t]!, -1, x, y, z, 0.3, 1, false);
      if (reg.burning[kind] === 1) this.fires.set(at, { x, y, z });
      return;
    }
    if (was !== kind) {
      // A swap in place: a door or a fire.
      if (reg.opens[was] === kind || reg.opens[kind] === was) {
        const metal = t === 3;
        // The shut door is the one its item places; the other is the door standing open.
        const opening = kind !== reg.places[reg.pieceItem[kind]!]?.[0];
        hear(o, opening ? (metal ? K.openMetal : K.openWood) : metal ? K.closeMetal : K.closeWood, -1, x, y + 1, z, 0, 1, false);
      } else if (reg.lights[was] === kind) {
        const lit = reg.burning[kind] === 1;
        hear(o, lit ? K.light : K.out, -1, x, y, z, 0.2, 1, false);
        if (lit) this.fires.set(at, { x, y, z });
        else this.fires.delete(at);
      }
      return;
    }
    if (hp < hpWas) hear(o, HIT[t]!, -1, x, y, z, 0.5, Math.min(1, 0.5 + (hpWas - hp) / Math.max(1, reg.maxHp[kind]!) * 4), false);
    else if (hp > hpWas) hear(o, K.repair, -1, x, y, z, 0.5, 0.8, false);
  }

  private heardNode(kind: number, x: number, y: number, z: number): void {
    const key = this.nodeKey[kind]!;
    if (key >= 0) this.hear!(this.nodeOwner[kind]!, key, -1, x, y, z, 0.5, 1, false);
  }
}
