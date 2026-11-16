// The asset slots of every definition: what each class expects (shared/content/classes.ts), filled in for the
// definitions there are. This is the list an asset pack is checked against and an asset library loads by.

import { BEARD_STYLES, HAIR_STYLES, SEX_IDS } from "../anim/look.ts";
import { classOf, classRow, type Slot } from "./classes.ts";
import type { Def } from "./defs.ts";

export interface SlotUse {
  /** The definition the slot belongs to. */
  owner: string;
  slot: string;
  /** "" for a slot with one value. For others what tells its values apart: "walk", "m/head", "human_f". */
  key: string;
  asset: Slot["asset"];
  need: Slot["need"];
  /** The asset the slot expects, by id. */
  id: string;
  /** What stands in, in order: asset ids, and words for what needs no asset. */
  fallback: readonly string[];
}

/** `core:raptor#clip/walk`. */
export function slotAddress(u: Pick<SlotUse, "owner" | "slot" | "key">): string {
  return `${u.owner}#${u.slot}${u.key === "" ? "" : `/${u.key}`}`;
}

type Vars = Readonly<Record<string, string>>;

/** `template` with its `{names}` filled from `vars` and from the definition. "" if a name has no value. */
function fill(template: string, d: Def, vars: Vars): string {
  let whole = true;
  const out = template.replace(/\{([^}]+)\}/g, (_, name: string) => {
    let v: unknown = vars[name];
    if (v === undefined && name === "id") v = d.id;
    // A generated mesh is named after its definition.
    else if (v === undefined && name === "mesh") v = "mesh" in d ? (d.mesh === "box" || d.mesh === "shape" ? d.id : d.mesh) : undefined;
    else if (v === undefined) v = name.split(".").reduce<unknown>((at, part) => (at as Record<string, unknown> | undefined)?.[part], d);
    if (typeof v !== "string" || v === "") whole = false;
    return String(v);
  });
  return whole ? out : "";
}

const styles = (list: readonly { id: string; source: unknown }[]): string[] => list.filter((s) => s.source !== null).map((s) => s.id);

/** Every slot of every definition, in the order of the definitions. */
export function slotsOf(defs: readonly Def[]): SlotUse[] {
  // The bodies armor is cut for: each sex of each species a survivor may be.
  const bodies = defs.flatMap((d) => (d.type === "species" && d.class === "survivor" ? SEX_IDS.map((sex) => `${d.mesh}_${sex}`) : []));
  const out: SlotUse[] = [];
  for (const d of defs) {
    const row = classRow(classOf(d));
    if (!row) continue;
    for (const [slot, s] of Object.entries(row.slots)) {
      if (s.when !== undefined && (d as unknown as Record<string, unknown>)[s.when] === undefined) continue;
      const sails = d.type === "structure" ? d.sails?.rig.sails : undefined;
      const keys = s.keys === undefined ? [""] : s.keys === "hair" ? styles(HAIR_STYLES) : s.keys === "beard" ? styles(BEARD_STYLES) : s.keys === "sails" ? sails?.map(s => s.id) ?? [] : s.keys === "any" ? [] : s.keys;
      const sexes = s.from.includes("{sex}") ? SEX_IDS : [""];
      const cut = s.from.includes("{body}") ? bodies : [""];
      for (const body of cut) {
        for (const sex of sexes) {
          for (const k of keys) {
            const vars: Vars = { key: k, sex, body, sail: sails?.find(s => s.id === k)?.mesh ?? "" };
            const id = fill(s.from, d, vars);
            const key = [body.slice(body.indexOf(":") + 1), sex, k].filter((part) => part !== "").join("/");
            out.push({ owner: d.id, slot, key, asset: s.asset, need: s.need, id, fallback: s.fallback.map((f) => (f.includes("{") ? fill(f, d, vars) : f)) });
          }
        }
      }
    }
  }
  return out;
}

/**
 * What fills a slot use, given which assets exist: its own asset, else the first fallback asset that exists. When only a
 * word is left (or nothing), `id` is "" and `word` says what stands in.
 */
export function fillSlot(u: SlotUse, has: (asset: Slot["asset"], id: string) => boolean): { id: string; word: string } {
  if (u.id !== "" && has(u.asset, u.id)) return { id: u.id, word: "" };
  for (const f of u.fallback) {
    if (!f.includes(":")) return { id: "", word: f };
    if (has(u.asset, f)) return { id: f, word: "" };
  }
  return { id: "", word: "none" };
}
