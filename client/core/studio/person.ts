// What the person stage (client/entry/person-stage.ts) holds of the one person it draws, from the messages its parent
// page sends (shared/people/stage.ts): the look, gear, wardrobe, prints, pose, hour and framing. Ids are judged against
// the stage's content here; the page shell only draws what this holds.

import { defaultLook, validLook, LOOK_BYTES, LOOK_SEX, SEX_IDS } from "../../../shared/anim/look.ts";
import { EMOTE_NUMBER } from "../../../shared/anim/emotes.ts";
import type { Clip } from "../../../shared/anim/clip.ts";
import type { HumanAnim } from "../../../shared/anim/pose.ts";
import type { Registry } from "../../../shared/content/registry.ts";
import { GEAR_COUNT, GEAR_HELD, GEAR_WORN, WORN_FIELDS } from "../../../shared/sim/entities.ts";
import { printPath, type EditionPrint } from "../../../shared/people/doc.ts";
import { STAGE_SLOTS, type StageCommand, type StageFraming, type StageGarment, type StagePose } from "../../../shared/people/stage.ts";

/** The most print pictures held at once; the oldest goes first. */
export const PRINTS_HELD = 8;
/** The item a tool pose holds when the gear holds none. */
export const STAGE_TOOL = "core:hatchet";

/** The edition a draft in wardrobe slot k is drawn as (plus k): a draft is edition 0, which draws no print. */
export const DRAFT_EDITION = 0xffffff00;

/** A held print: its key, the hash it is drawn under (one a picture sent), and once the shell has read it, its size. */
export interface HeldPrint {
  readonly key: string;
  readonly hash: string;
  width: number;
  height: number;
}

/** Where the view looks from: a yaw (0 looks along +Z, at the person's back), a pitch, and a ball to keep in view. */
export interface Framing {
  readonly yaw: number;
  readonly pitch: number;
  readonly y: number;
  readonly radius: number;
}

/** A person faces +Z, so the view from in front is at yaw pi. Heights are metres over the ground for a standing body. */
const FRAMINGS: Record<StageFraming, Framing> = {
  full: { yaw: Math.PI, pitch: -0.08, y: 0.9, radius: 1.0 },
  portrait: { yaw: Math.PI, pitch: -0.04, y: 1.58, radius: 0.32 },
  back: { yaw: 0, pitch: -0.1, y: 0.9, radius: 1.0 },
  "three-quarter": { yaw: Math.PI + 0.6, pitch: -0.14, y: 0.9, radius: 1.0 },
};
/** How much lower a seated body's middle and head are. */
const SEATED_DROP = { full: 0.42, head: 0.62 } as const;

export function framingOf(framing: StageFraming, pose: StagePose): Framing {
  const f = FRAMINGS[framing];
  if (pose !== "seated") return f;
  return { ...f, y: f.y - (framing === "portrait" ? SEATED_DROP.head : SEATED_DROP.full), radius: framing === "portrait" ? f.radius : f.radius * 0.75 };
}

export class PersonStage {
  readonly look = defaultLook();
  /** Content indices: the held item and the five armor slots, 0 for none. */
  readonly gear = new Uint16Array(GEAR_COUNT);
  readonly wardrobe: (StageGarment | null)[] = new Array<StageGarment | null>(STAGE_SLOTS).fill(null);
  /** The skin zones a draft's garments cover, a bit each (shared/anim/skin-zones.ts). */
  hide = 0;
  readonly prints: HeldPrint[] = [];
  /** By wardrobe slot, the print it is drawn with, as the game draws an edition's (Scene.editionPrint). */
  private readonly drawn: (EditionPrint | null)[] = new Array<EditionPrint | null>(STAGE_SLOTS).fill(null);
  private pictures = 0;
  pose: StagePose = "idle";
  /** The share of the way through its move a pose is held at, or null while it plays. */
  at: number | null = null;
  hour = 11;
  framing: StageFraming = "three-quarter";
  /** Bumped by each change that alters what is drawn, so the shell knows to wait for the frame to settle again. */
  version = 0;

  private readonly reg: Registry;

  constructor(reg: Registry) {
    this.reg = reg;
  }

  /**
   * Takes `c` and says what is now held of its kind, with a note for each id the content has not. A picture changes
   * nothing here. A print is held by key; its picture is the shell's to load.
   */
  apply(c: StageCommand): { held: unknown; notes: string[] } {
    const notes: string[] = [];
    switch (c.kind) {
      case "look":
        if (!validLook(c.look)) {
          notes.push("the look's bytes are out of range; the look is kept as it was");
          break;
        }
        this.look.set(c.look);
        this.version++;
        break;
      case "gear": {
        this.gear[GEAR_HELD] = c.held === null ? 0 : this.item(c.held, notes, -1);
        for (let k = 0; k < STAGE_SLOTS; k++) {
          const id = c.armor[k] ?? null;
          this.gear[GEAR_WORN + k] = id === null ? 0 : this.item(id, notes, k);
        }
        this.version++;
        break;
      }
      case "wardrobe":
        for (let k = 0; k < STAGE_SLOTS; k++) {
          const g = c.slots[k] ?? null;
          this.wardrobe[k] = g && this.item(g.item, notes, -1) ? g : null;
        }
        this.hide = c.hide;
        this.redraw();
        break;
      case "print": {
        const at = this.prints.findIndex((p) => p.key === c.key);
        if (at >= 0) this.prints.splice(at, 1);
        this.prints.push({ key: c.key, hash: `stage${++this.pictures}`, width: 0, height: 0 });
        while (this.prints.length > PRINTS_HELD) this.prints.shift();
        this.redraw();
        break;
      }
      case "pose":
        this.pose = c.pose;
        this.at = c.at;
        this.version++;
        break;
      case "hour":
        this.hour = c.hour;
        this.version++;
        break;
      case "framing":
        this.framing = c.framing;
        this.version++;
        break;
      case "picture":
        break;
    }
    return { held: this.heldOf(c.kind), notes };
  }

  /** The shell read print `key`'s picture: `width` x `height`. */
  sized(key: string, width: number, height: number): void {
    const p = this.prints.find((x) => x.key === key);
    if (!p) return;
    p.width = width;
    p.height = height;
    this.redraw();
  }

  /** Print `key` could not be read: it is no longer held. */
  unheld(key: string): void {
    const at = this.prints.findIndex((p) => p.key === key);
    if (at >= 0) this.prints.splice(at, 1);
    this.redraw();
  }

  /** Where the renderer asks for a held print's picture (Prints fetches printPath of its hash). */
  pathOf(key: string): string | null {
    const p = this.prints.find((x) => x.key === key);
    return p ? printPath(p.hash) : null;
  }

  /** The print of an edition as wornInto numbers it, or null: what Scene.editionPrint answers on the stage. */
  printOf(edition: number): EditionPrint | null {
    for (let k = 0; k < STAGE_SLOTS; k++) if (this.wardrobe[k] && this.editionAt(k) === edition) return this.drawn[k]!;
    return null;
  }

  private editionAt(k: number): number {
    return this.wardrobe[k]!.edition || DRAFT_EDITION + k;
  }

  /** Each slot's print from the wardrobe and the prints held, made once a change so the renderer keeps its key. */
  private redraw(): void {
    for (let k = 0; k < STAGE_SLOTS; k++) {
      const g = this.wardrobe[k], p = g?.print ? this.prints.find((x) => x.key === g.print!.key) : undefined;
      this.drawn[k] = g?.print && p && p.width > 0 ? { hash: p.hash, width: p.width, height: p.height, place: g.print.place } : null;
    }
    this.version++;
  }

  /**
   * The wardrobe as the renderer takes it (Characters.wardrobe) into `out`, WORN_LENGTH numbers: per slot the item's
   * content index, its edition (a draft's DRAFT_EDITION) and its dye packed as Inventory.dyeOf does. False while it wears nothing.
   */
  wornInto(out: Uint32Array): boolean {
    let any = false;
    for (let k = 0; k < STAGE_SLOTS; k++) {
      const g = this.wardrobe[k], item = g ? (this.reg.index.get(g.item) ?? 0) : 0;
      out[k * WORN_FIELDS] = item;
      out[k * WORN_FIELDS + 1] = item === 0 ? 0 : this.editionAt(k);
      out[k * WORN_FIELDS + 2] = item === 0 ? 0 : (g!.dye[0] | (g!.dye[1] << 8) | (g!.dye[2] << 16)) >>> 0;
      if (item !== 0) any = true;
    }
    return any;
  }

  /** What is held of a kind, as the stage answers it: ids, not content indices. */
  heldOf(kind: StageCommand["kind"]): unknown {
    const id = (i: number): string | null => (i > 0 ? this.reg.ids[i]! : null);
    switch (kind) {
      case "look":
        return { sex: SEX_IDS[this.look[LOOK_SEX]!], bytes: LOOK_BYTES };
      case "gear":
        return { held: id(this.gear[GEAR_HELD]!), armor: Array.from({ length: STAGE_SLOTS }, (_, k) => id(this.gear[GEAR_WORN + k]!)) };
      case "wardrobe":
        // A garment whose cut is made is drawn (wornInto).
        return { slots: this.wardrobe.map((g) => g && { ...g }), hide: this.hide, drawn: true };
      case "print":
        return { prints: this.prints.map((p) => ({ key: p.key, width: p.width, height: p.height })), drawn: true };
      case "pose":
        return { pose: this.pose, at: this.at };
      case "hour":
        return { hour: this.hour };
      case "framing":
        return { framing: this.framing };
      case "picture":
        return null;
    }
  }

  /** The content index of item `id`, worn in armor slot `slot` (-1 for any item), or 0 with a note. */
  private item(id: string, notes: string[], slot: number): number {
    const i = this.reg.index.get(id) ?? 0;
    if (i === 0 || this.reg.defs[i]?.type !== "item") notes.push(`${id} is not an item here`);
    else if (slot >= 0 && this.reg.wearSlot[i] !== slot) notes.push(`${id} is not worn in armor slot ${slot}`);
    else return i;
    return 0;
  }

  /** The move a pose plays and the item it holds: the gear's held item, or for a tool pose a hatchet where it holds none. */
  move(anim: HumanAnim): { clip: Clip | null; held: number } {
    const held = this.gear[GEAR_HELD]!;
    switch (this.pose) {
      case "idle":
        return { clip: anim.idle, held };
      case "walk":
        return { clip: anim.walk, held };
      case "tool":
        return { clip: anim.toolCarry, held: held || (this.reg.index.get(STAGE_TOOL) ?? 0) };
      case "seated":
        return { clip: anim.emotes[EMOTE_NUMBER.get("sit")!] ?? null, held };
    }
  }

  /** Writes the person as actor `k` of a sample: survivor, look and gear. */
  writeActor(actors: { kind: Uint16Array; hasLook: Uint8Array; look: Uint8Array; gear: Uint16Array }, k: number, survivor: number, held: number): void {
    actors.kind[k] = survivor;
    actors.hasLook[k] = 1;
    actors.look.set(this.look, k * LOOK_BYTES);
    actors.gear.set(this.gear, k * GEAR_COUNT);
    actors.gear[k * GEAR_COUNT + GEAR_HELD] = held;
  }
}
