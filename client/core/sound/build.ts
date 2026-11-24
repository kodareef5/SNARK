// What building and the world's nodes are heard doing, from the structure rows and used-up nodes the client is sent
// (ClientSession.onStructure, onNode): a piece placed, struck, mended, destroyed, brought down or taken up; a door
// opening or shutting and a fire lit or put out (each a swap of kinds in the same slot); a tree felled, a rock broken,
// a bush stripped. Lit fires near the ear crackle while they burn, found in the rows as they are now, so a fire lit
// before the player came is heard and one put out while they were away is not. Each piece is heard by its own sounds
// where it has them, else by its material's (the `{tier}` of shared/sound/cues.ts). Pieces that break are heard a cell
// of them at a time (`breaking`, fed by break-effects.ts), so a street falling is a few sounds and not a thousand.

import type { Registry } from "../../../shared/content/registry.ts";
import { cueKey } from "../../../shared/sound/cues.ts";
import { GONE_BLAST, GONE_DESTROYED, GONE_FELL, GONE_TAKEN } from "../../../shared/world/structures.ts";
import { HEARD_CRACK, HEARD_GLASS, HEARD_IMPACT, type BreakSounds } from "../break-effects.ts";
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
  glass: cueKey("impact/glass"),
};
/** How loud a city piece's stage crossing or change of form is heard. Its health is not told within a stage, so a blow's own size is not known. */
const CITY_GAIN = 0.9;
/** Metres within which a lit fire is heard burning, and how many at most; the rows are looked through every few frames. */
const FIRE_REACH = 20;
const FIRES = 3;
const FIRE_FRAMES = 8;

/** Fills `out` with x, y, z and kind of each structure within about `r` metres of (x, z) that burns. */
export type Lit = (x: number, z: number, r: number, out: number[]) => void;

export class BuildSounds implements BreakSounds {
  private readonly reg: Registry;
  /** By structure kind: its tier (an index of TIERS), its owner number, and whether it is a door (1) or a fire (2). */
  private readonly tier: Int8Array;
  private readonly owner: Int32Array;
  private readonly role: Uint8Array;
  /** By structure kind: 1 for a static, a piece of the map. */
  private readonly placed: Uint8Array;
  /** By node kind: its owner number and what using it up sounds like. */
  private readonly nodeOwner: Int32Array;
  private readonly nodeKey: Int32Array;
  private readonly queue: (() => void)[] = [];
  /** The lit fires near the ear when last looked for: x, y, z and kind of each. */
  private readonly fires: number[] = [];
  private readonly near: number[] = [];
  private frame = 0;

  constructor(reg: Registry, ownerOf: (id: string) => number) {
    this.reg = reg;
    const n = reg.defs.length;
    this.tier = new Int8Array(n).fill(2);
    this.owner = new Int32Array(n).fill(-1);
    this.role = new Uint8Array(n);
    this.placed = new Uint8Array(n);
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
        if ((d as { class?: string }).class === "static") this.placed[kind] = 1;
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

  /**
   * Whether a row's change is heard through `breaking` and so not by its row: a piece destroyed, fallen or blown apart,
   * and a city piece taking a form or losing health.
   */
  merged(was: number, kind: number, cause: number): boolean {
    if (kind === 0) return cause === GONE_DESTROYED || cause === GONE_FELL || cause === GONE_BLAST;
    return was !== 0 && this.reg.breakSet[was] !== 0 && (was === kind || this.reg.breakSet[kind] === this.reg.breakSet[was]);
  }

  /**
   * One sound for a cell of pieces breaking at a place: `what` a HEARD_, `kind` one of the pieces, whose own sounds or
   * material's are heard, `level` 0 to 1. Every city material is heard as stone until the tiers know them.
   */
  breaking(what: number, kind: number, x: number, y: number, z: number, level: number): void {
    this.queue.push(() => {
      const o = this.owner[kind] ?? -1, t = this.tier[kind] ?? 2;
      this.hear!(o, what === HEARD_IMPACT ? DESTROY[t]! : what === HEARD_CRACK ? HIT[t]! : what === HEARD_GLASS ? K.glass : K.collapse, -1, x, y, z, 0.5, level, false);
    });
  }

  /** A node used up (ClientSession.onNode), of `kind` at (x, y, z). */
  node(kind: number, x: number, y: number, z: number): void {
    this.queue.push(() => this.heardNode(kind, x, y, z));
  }

  /** A nearby physical tree break layers a short hull thud under its existing wood crack. */
  treeImpact(kind: number, x: number, y: number, z: number): void {
    this.queue.push(() => { this.heardNode(kind, x, y, z); this.hear!(this.nodeOwner[kind] ?? -1, HIT[3]!, -1, x, y, z, .3, .7, false); });
  }

  private hear: Hear | null = null;

  /** One frame: what changed since the last, heard; and the fires `lit` finds near (ex, ey, ez) held burning through `burn`. */
  /** Whether a lit fire burns within hearing of the ear: the music hears a camp. */
  fireNear = false;

  update(ex: number, ey: number, ez: number, hear: Hear, burn: (id: number, owner: number, key: number, x: number, y: number, z: number, on: boolean) => void, lit: Lit | null = null): void {
    this.hear = hear;
    for (const f of this.queue) f();
    this.queue.length = 0;
    const fires = this.fires;
    if (this.frame++ % FIRE_FRAMES === 0) {
      fires.length = 0;
      lit?.(ex, ez, FIRE_REACH, fires);
    }
    // The nearest few, as indices into `fires`.
    const near = this.near;
    near.length = 0;
    for (let f = 0; f < fires.length; f += 4) if (Math.hypot(fires[f]! - ex, fires[f + 1]! - ey, fires[f + 2]! - ez) < FIRE_REACH) near.push(f);
    const d = (f: number): number => Math.hypot(fires[f]! - ex, fires[f + 1]! - ey, fires[f + 2]! - ez);
    near.sort((a, b) => d(a) - d(b));
    this.fireNear = near.length > 0;
    for (let i = 0; i < FIRES; i++) {
      const f = near[i];
      burn(i, f === undefined ? -1 : this.owner[fires[f + 3]!]!, K.burn, f === undefined ? 0 : fires[f]!, f === undefined ? 0 : fires[f + 1]!, f === undefined ? 0 : fires[f + 2]!, f !== undefined);
    }
  }

  private heardStructure(was: number, kind: number, x: number, y: number, z: number, hpWas: number, hp: number, cause: number): void {
    const hear = this.hear!;
    const reg = this.reg;
    if (kind === 0) {
      const o = this.owner[was]!;
      const t = this.tier[was]!;
      if (cause === GONE_DESTROYED || cause === GONE_BLAST) hear(o, DESTROY[t]!, -1, x, y, z, 0.5, 1, false);
      else if (cause === GONE_FELL) hear(o, K.collapse, -1, x, y, z, 0.5, 0.7, false);
      else if (cause === GONE_TAKEN) hear(o, K.demolish, -1, x, y, z, 0.5, 0.9, false);
      return;
    }
    const o = this.owner[kind]!;
    const t = this.tier[kind]!;
    if (was === 0) {
      hear(o, PLACE[t]!, -1, x, y, z, 0.3, 1, false);
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
      } else if (reg.breakSet[kind] !== 0 && reg.breakSet[kind] === reg.breakSet[was]) {
        // A city piece took a broken form.
        hear(o, HIT[t]!, -1, x, y, z, 0.5, CITY_GAIN, false);
      }
      return;
    }
    if (hp < hpWas) hear(o, HIT[t]!, -1, x, y, z, 0.5, this.placed[kind] === 1 ? CITY_GAIN : Math.min(1, 0.5 + (hpWas - hp) / Math.max(1, reg.maxHp[kind]!) * 4), false);
    else if (hp > hpWas) hear(o, K.repair, -1, x, y, z, 0.5, 0.8, false);
  }

  private heardNode(kind: number, x: number, y: number, z: number): void {
    const key = this.nodeKey[kind]!;
    if (key >= 0) this.hear!(this.nodeOwner[kind]!, key, -1, x, y, z, 0.5, 1, false);
  }
}
