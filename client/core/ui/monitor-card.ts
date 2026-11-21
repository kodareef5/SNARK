// What the resource monitor's inspect card says (ui/monitor.ts draws it beside the crosshair while H is held, and by
// touch the strip's last line): what is looked at and how far, its model's level, and for each of its textures what
// is shown, what is wanted, what it was authored at and why it waits, in plain words: "Sidewall normal 256 px, wants
// 1024" over "downloaded, waiting for the card", or "Tread colour 256 px: authored at 256". Made ten times a second at
// most, with the strip's words; nothing here runs in a frame of its own.

import { inspectMesh, inspectTexture, type LevelInspection, type TextureInspection, type Why } from "../assets/inspect.ts";
import { plainName, type LookPick } from "../assets/look.ts";
import type { Residency } from "../assets/residency.ts";
import type { TextureRole } from "../../../shared/pack/texture.ts";

/** A map's role, in words. */
export const ROLE_WORDS: Readonly<Record<TextureRole, string>> = { base: "colour", normal: "normal", mro: "packed map", mask: "mask", mask2: "second mask", layer: "wear layer" };
const ROLES: readonly TextureRole[] = ["base", "normal", "mro", "mask", "mask2"];
const MB = 1048576;

const size = (bytes: number): string => (bytes >= 1000 * 1024 ? `${(bytes / MB).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/** Why something wanted waits, in words, as the residency said when it last passed it over (inspect.ts `Why`). */
export const WHY_WORDS: Readonly<Record<Why, string>> = {
  "": "to be asked for next",
  lanes: "waiting its turn: as many downloads as may be are under way",
  waiting: "waiting its turn: much has come for the card already",
  retry: "failed, to be asked for again",
  firsts: "waiting while other textures get their first step",
  share: "waiting for room in the textures' share of the card",
  level: "waiting for its model's level",
  large: "waiting for a lane for large downloads",
  allowance: "downloaded, waiting for the card",
  full: "waiting: the graphics card is full",
};

/** Where a slot that is wanted stands, in words. */
function standing(state: string, why: Why, bytes: number, tries: number): string {
  if (state === "loading" || state === "riding") return bytes > 0 ? `downloading ${size(bytes)}` : "downloading";
  if (state === "arrived") return why === "share" || why === "full" ? `downloaded, ${WHY_WORDS[why]}` : "downloaded, waiting for the card";
  if (state === "dead") return "failed for good";
  return why === "retry" && tries > 1 ? `failed ${tries} times, to be asked for again` : WHY_WORDS[why];
}

/**
 * A texture's line, and under it why it waits or "" where it does not: what is shown, and what is wanted where that is
 * more; else why what is shown is all it has.
 */
export function textureWords(name: string, t: TextureInspection): [string, string] {
  const shown = t.showing > 0 ? `${name} ${t.showing} px` : `${name} none yet`;
  if (t.wanted > t.showing || (t.showing === 0 && t.state !== "absent")) return [t.wanted > t.showing ? `${shown}, wants ${t.wanted}` : shown, standing(t.state, t.why, t.comingBytes, t.tries)];
  // None on the card and none wanted: its model is drawn in flat colours until it is asked for.
  if (t.showing === 0) return [shown, t.why !== "" ? WHY_WORDS[t.why] : "not asked for: drawn without it"];
  if (t.shrinking) return [shown, `making room: a ${t.coming} px copy is coming`];
  if (t.lowered && t.showing >= t.most) return [`${shown}: the most it can have`, `a larger step failed to come`];
  if (t.showing >= t.authored) return [`${shown}: authored at ${t.authored}`, ""];
  if (t.variant > 0 && t.showing >= t.variant) return [`${shown}: the most this format holds`, `authored at ${t.authored}`];
  if (t.tier > 0 && t.showing >= t.tier) return [`${shown}: the most this graphics level takes`, `authored at ${t.authored}`];
  return [t.onScreen ? `${shown}: as large as it is shown` : `${shown}: not on screen`, ""];
}

/** The model's line: the level drawn, of how many, and the level wanted where it is not the one drawn, with why. */
export function levelWords(pick: LookPick, levels: readonly LevelInspection[]): [string, string] {
  const count = levels.length;
  if (pick.shown < 0) {
    const want = levels[Math.max(0, pick.wanted)];
    return [`No level drawn yet, of ${count}`, want ? standing(want.state, want.why, want.bytes, want.tries) : ""];
  }
  const shown = levels[pick.shown]!;
  const line = `Model level ${pick.shown} of ${count} · ${size(shown.bytes)}`;
  if (pick.wanted < 0 || pick.wanted >= pick.shown) return [line, ""];
  const want = levels[pick.wanted]!;
  return [`${line}, wants ${pick.wanted}`, standing(want.state, want.why, want.bytes, want.tries)];
}

/** The card's lines for `pick`: `lines` its main lines, `under` what goes under each ("" for nothing), at most `room` rows in all. */
export function cardWords(r: Residency | null, pick: LookPick, room: number, lines: string[], under: string[]): void {
  lines.length = under.length = 0;
  const far = `${Math.round(pick.distance)} m`;
  if (pick.what === "none") {
    lines.push(`Nothing within ${far}`);
    under.push("the sky, or what the ray does not meet: far city tiles, facades, water");
    return;
  }
  if (pick.what === "ground") {
    lines.push(`Ground · ${far}${pick.water ? ", under water" : ""}`);
    under.push("drawn from the map and its finishes, not a model");
    return;
  }
  lines.push(`${plainName(pick.id)} · ${far}${pick.water ? ", under water" : ""}`);
  under.push("");
  if (!r || pick.mesh < 0) {
    lines.push("Drawn as nothing of its own");
    under.push("");
    return;
  }
  const mesh = inspectMesh(r, pick.mesh);
  if (!mesh.known) {
    lines.push("Its model's row has not come");
    under.push(mesh.pageState === "loading" || mesh.pageState === "riding" ? "its page is downloading" : "its page is to be asked for");
    return;
  }
  const level = levelWords(pick, mesh.levels);
  lines.push(level[0]);
  under.push(level[1]);
  const at = mesh.levels[pick.shown >= 0 ? pick.shown : Math.max(0, pick.wanted)]!;
  const materials = pick.material >= 0 ? at.materials.filter((m) => m.material === pick.material) : at.materials;
  if (at.materials.length === 0) {
    lines.push("Flat colours: this level has no textures");
    under.push("");
    return;
  }
  if (pick.material < 0 && materials.length > 1) {
    lines.push(`${materials.length} materials; which is under the crosshair is not known`);
    under.push("");
  }
  let left = 0, rows = 0;
  for (let i = 0; i < lines.length; i++) rows += under[i] === "" ? 1 : 2;
  for (const m of materials) for (let k = 0; k < ROLES.length; k++) {
    const t = m.maps[k]!;
    if (t < 0) continue;
    const words = textureWords(`${plainName(m.id)} ${ROLE_WORDS[ROLES[k]!]}`, inspectTexture(r, t));
    // Room is kept for the line that says how many more there are.
    if (rows + (words[1] === "" ? 1 : 2) > room - 1) {
      left++;
      continue;
    }
    lines.push(words[0]);
    under.push(words[1]);
    rows += words[1] === "" ? 1 : 2;
  }
  if (left > 0) {
    lines.push(`and ${left} more`);
    under.push("");
  }
}

/** What is looked at, in one line, for the strip by touch: "Tall palm · 38 m · level 2 · Bark colour 512 px, wants 1024". */
export function pickLine(r: Residency | null, pick: LookPick): string {
  if (pick.what === "none") return "Looking at nothing the ray meets";
  const far = `${Math.round(pick.distance)} m`;
  if (pick.what === "ground") return `Ground · ${far}`;
  const name = `${plainName(pick.id)} · ${far}`;
  if (!r || pick.mesh < 0 || pick.shown < 0) return name;
  const mesh = inspectMesh(r, pick.mesh), at = mesh.levels[pick.shown]!;
  const level = `level ${pick.shown}${pick.wanted >= 0 && pick.wanted < pick.shown ? ` (wants ${pick.wanted})` : ""}`;
  const m = pick.material >= 0 ? at.materials.find((x) => x.material === pick.material) : at.materials[0];
  const t = m ? m.maps[0]! : -1;
  if (!m || t < 0) return `${name} · ${level}`;
  return `${name} · ${level} · ${textureWords(`${plainName(m.id)} ${ROLE_WORDS.base}`, inspectTexture(r, t))[0]}`;
}
