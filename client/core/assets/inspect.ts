// What the data utility's inspect card says of a texture and of a model: what the card holds of it, what is on its way,
// what is wanted and why it waits, and what it was authored at, so a texture that looks unfinished can be told from one
// that is finished. Asked for when wanted, never in a frame of its own. Like the record of frames, it is not in the
// script the first frame waits for (D900): it reads the residency's own arrays by name (`r["has"]`), which TypeScript
// checks as it does any other read, and it writes nothing.

import type { TextureRole } from "../../../shared/pack/texture.ts";
import type { Residency } from "./residency.ts";
// Copies of the residency's and the textures' numbers, as the resource monitor, which fetches this file, imports
// nothing of the first frame's script (copied.ts, D902).
import { ABSENT, ARRIVED, DEAD, LAST_STEP, LOADING, MAPS, RESIDENT, RIDING, STEP0_SIZE, WHY_ALLOWANCE, WHY_FIRSTS, WHY_FULL, WHY_LANES, WHY_LARGE, WHY_LEVEL, WHY_NONE, WHY_RETRY, WHY_SHARE, WHY_WAITING, stepFor, stepOf, topIn } from "./copied.ts";

export type SlotState = "absent" | "loading" | "arrived" | "resident" | "dead" | "riding";
/**
 * Why what is wanted waits ("" for nothing, or nothing wanted): `lanes`, as many requests are under way as may be;
 * `waiting`, enough has arrived and waits for the card; `retry`, it failed and waits to be asked again; `firsts`, a
 * texture on screen lacks its first step; `share`, the textures' share of the card is spoken for; `level`, a surface's
 * level is not here; `large`, the lanes for large parts are full; `allowance`, the frame's bytes for the card are
 * spent; `full`, the card is over-full.
 */
export type Why = "" | "lanes" | "waiting" | "retry" | "firsts" | "share" | "level" | "large" | "allowance" | "full";

const STATES: Record<number, SlotState> = { [ABSENT]: "absent", [LOADING]: "loading", [ARRIVED]: "arrived", [RESIDENT]: "resident", [DEAD]: "dead", [RIDING]: "riding" };
const WHYS: Record<number, Why> = { [WHY_NONE]: "", [WHY_LANES]: "lanes", [WHY_WAITING]: "waiting", [WHY_RETRY]: "retry", [WHY_FIRSTS]: "firsts", [WHY_SHARE]: "share", [WHY_LEVEL]: "level", [WHY_LARGE]: "large", [WHY_ALLOWANCE]: "allowance", [WHY_FULL]: "full" };
const STEPS = LAST_STEP + 1;

export interface TextureInspection {
  texture: number;
  id: string;
  role: TextureRole;
  /** Pixels across of the copy the card draws with, and of the copy on its way: 0 for none. */
  showing: number;
  coming: number;
  /**
   * Pixels across it is wanted at, after the tier's, its authoring's and its variant's caps but not after a failure's,
   * and the pixels the scene said it shows before the caps; both 0 where it was not on screen in the last frame. While
   * the card is over-full the scene says fewer, by `relax`.
   */
  wanted: number;
  asked: number;
  relax: number;
  /**
   * Pixels across it was authored at, the most its variant holds (RGBA stops at 1,024), the most the graphics tier
   * takes, and the most it can have: less than the variant's where a step failed for good, and then `lowered`.
   */
  authored: number;
  variant: number;
  tier: number;
  most: number;
  lowered: boolean;
  state: SlotState;
  why: Why;
  /** Bytes of the copy the card draws with, of the copy on its way and how many of those the card has been handed, and of it that came over the network, every copy. */
  bytes: number;
  comingBytes: number;
  sent: number;
  fetched: number;
  /** The copy on its way is smaller than the one drawn, to give room back. */
  shrinking: boolean;
  /** Failures in a row, and when it may be asked for again, in ms. */
  tries: number;
  retryAt: number;
  onScreen: boolean;
}

/** A level of a mesh, or its surface, which is what it needs besides to be drawn with materials. */
export interface SlotInspection {
  state: SlotState;
  bytes: number;
  /** The boot pack or a page that has come holds it: it is never fetched or let go. */
  held: boolean;
  /** Wanted in the last frame, why it waits, and bytes the card has been handed while it goes up in pieces. */
  wanted: boolean;
  why: Why;
  sent: number;
  tries: number;
  retryAt: number;
}

export interface LevelInspection extends SlotInspection {
  level: number;
  /** On the card and not drawn, while its surface is not. */
  apart: boolean;
  /** Its surface, or null for a level never drawn with materials. */
  surface: SlotInspection | null;
  /** Each material of its sections: its textures by role (base colour, normal, packed map, two masks), and its hurt and decay layer, -1 for none. */
  materials: { material: number; id: string; maps: number[]; layer: number }[];
}

export interface MeshInspection {
  mesh: number;
  id: string;
  /** Whether its row is here. Until it is, nothing of it is drawn and its page is what is wanted. */
  known: boolean;
  page: number;
  pageState: SlotState | null;
  levels: LevelInspection[];
}

/** What the card holds of texture `t` (its index in the manifest), what is coming and wanted, and why it waits. */
export function inspectTexture(r: Residency, t: number): TextureInspection {
  const tex = r["manifest"].textures![t]!;
  const slot = r["texBase"] + t;
  const state = r["state"][slot]!;
  const has = r["has"][t]!, limit = r["limit"][t]!;
  const variant = tex.in[r["made"]] ? topIn(r["made"], tex.top) : 0;
  const onScreen = r["seen"][slot] === r["frame"];
  const coming = state === LOADING || state === ARRIVED;
  // A texture waits where it joined the last frame's wants, or has arrived. Otherwise it has what it is wanted at.
  const waits = state === ARRIVED || (state === ABSENT && r["queued"][t] === r["frame"]);
  return {
    texture: t,
    id: tex.id,
    role: tex.role,
    showing: has < 0 ? 0 : STEP0_SIZE << has,
    coming: coming ? STEP0_SIZE << r["goal"][t]! : 0,
    wanted: onScreen && variant > 0 ? STEP0_SIZE << stepFor(r["px"][t]!, stepOf(variant)) : 0,
    asked: onScreen ? r["askedPx"][t]! : 0,
    relax: r.relax,
    authored: tex.top,
    variant,
    tier: r.cap < 0 ? 0 : STEP0_SIZE << r.cap,
    most: limit < 0 ? 0 : STEP0_SIZE << limit,
    lowered: r["lowered"][t] === 1,
    state: STATES[state]!,
    why: waits ? WHYS[r["why"][slot]!]! : "",
    bytes: has < 0 ? 0 : r["through"][t * STEPS + has]!,
    comingBytes: coming ? r["size"][slot]! : 0,
    sent: r["gone"][t]!,
    fetched: r["texFetched"][t]!,
    shrinking: r["down"][t] === 1,
    tries: r["tries"][slot]!,
    retryAt: r["retryAt"][slot]!,
    onScreen,
  };
}

/** Each level of mesh `m` (its index in the manifest), its surface and its materials: what the card holds, what is coming, and why what is wanted waits. */
export function inspectMesh(r: Residency, m: number): MeshInspection {
  const mesh = r["manifest"].meshes[m]!;
  const levels = r["levels"], frame = r["frame"], first = r["first"][m]!;
  const page = r["pageOf"][m]!;
  const slotOf = (slot: number): SlotInspection => {
    const state = r["state"][slot]!, held = r["inBoot"][slot] === 1, wanted = r["seen"][slot] === frame;
    return {
      state: STATES[state]!,
      bytes: r["size"][slot]!,
      held,
      wanted,
      why: state === ARRIVED || (state === ABSENT && wanted && !held) ? WHYS[r["why"][slot]!]! : "",
      sent: slot < r["texBase"] ? r["given"][slot]! : 0,
      tries: r["tries"][slot]!,
      retryAt: r["retryAt"][slot]!,
    };
  };
  const materials = r["manifest"].materials ?? [];
  return {
    mesh: m,
    id: mesh.id,
    known: r["knownMesh"][m] === 1,
    page,
    pageState: page < 0 ? null : STATES[r["state"][r["pageBase"] + page]!]!,
    levels: mesh.levels.map((_, l) => {
      const slot = first + l;
      const runs = r["runs"][slot]!;
      const own: LevelInspection["materials"] = [];
      for (let k = 0; k < runs.length; k += 3) {
        const at = runs[k]!;
        if (own.some((x) => x.material === at)) continue;
        own.push({ material: at, id: materials[at]?.id ?? "", maps: Array.from(r["matTex"].subarray(at * MAPS, at * MAPS + MAPS)), layer: r["matLayer"][at]! });
      }
      return { level: l, ...slotOf(slot), apart: r["apart"][slot] === 1, surface: r["size"][levels + slot]! > 0 ? slotOf(levels + slot) : null, materials: own };
    }),
  };
}
