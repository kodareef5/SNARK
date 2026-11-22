// Where, what and how, as a bug report says them (shared/report.ts): the survivor's place and the street under its feet,
// the view, what the crosshair is on (assets/look.ts), the hour and the sun, the page and its settings. Read from the
// app's fields by name, as the inspectors do (D900), and from the kit for the first frame's code (notes-kit.ts).

import type { App } from "../app.ts";
import { emptyPick, pickLook } from "../assets/look.ts";
import type { NotesKit } from "../notes-kit.ts";
import type { FramePacket } from "../render/packet.ts";
import type { Point, Report } from "../../../shared/report.ts";
import { CHUNK_SIZE, FRAME_SUN, KERBS, MODE_NAMES, SECTOR_CHUNKS, SESSION_ALIVE, STREET_ONE_WAY, STREET_PAIRED, VERGES, WALKS } from "./copies.ts";

const r2 = (v: number): number => Math.round(v * 100) / 100;
const point = (x: number, y: number, z: number): Point => [r2(x), r2(y), r2(z)];

/** The survivor's feet, its chunk and sector, the ground and water there, and the street nearest, if any is held near. */
export function placeOf(app: App, kit: NotesKit): Report["place"] {
  const s = app.session, own = s.own, world = s.world;
  const cx = Math.floor(own.x / CHUNK_SIZE), cz = Math.floor(own.z / CHUNK_SIZE);
  const dims = world?.dims;
  const out: NonNullable<Report["place"]> = {
    x: r2(own.x), y: r2(own.y), z: r2(own.z), chunk: [cx, cz],
    sector: [Math.floor(((dims?.frameX ?? 0) + cx) / SECTOR_CHUNKS), Math.floor(((dims?.frameZ ?? 0) + cz) / SECTOR_CHUNKS)],
  };
  const hf = world?.hf;
  if (!hf) return out;
  out.ground = r2(hf.heightAt(own.x, own.z));
  out.water = r2(hf.waterAt(own.x, own.z));
  const p = new kit.StreetPoint();
  if (hf.streets && kit.streetAt(hf.streets, own.x, own.z, p) && p.near) {
    // A side's kinds in a byte (streets.ts kindsByte): its verge in bits 0 to 2, its walk in 3 and 4, its kerb in 5 and 6.
    const kinds = p.kinds;
    out.street = {
      d: r2(p.d), type: p.type, seed: p.seed, verge: r2(p.verge), walk: r2(p.walk),
      vergeKind: VERGES[kinds & 7] ?? "?", walkKind: WALKS[(kinds >> 3) & 3] ?? "?", kerbKind: KERBS[(kinds >> 5) & 3] ?? "?",
    };
    const flags = streetFlags(hf.streets, p.type, p.seed);
    if (flags >= 0) Object.assign(out.street, { oneWay: (flags & STREET_ONE_WAY) !== 0, paired: (flags & STREET_PAIRED) !== 0 });
  }
  return out;
}

/** The flags of the held stretch of `type` and `seed`, -1 where none is held. */
function streetFlags(streets: { parts(): readonly { stretches: readonly { type: number; seed: number; flags: number }[] }[] }, type: number, seed: number): number {
  for (const part of streets.parts()) for (const s of part.stretches) if (s.type === type && s.seed === seed) return s.flags;
  return -1;
}

/** The camera, the eye, the look the input sends, and how the view is taken. */
export function viewOf(app: App): Report["view"] {
  const cam = app.cam, s = app.session, eye = app["eye"] < 0 ? 0 : app["eye"], own = s.own;
  return {
    camera: point(cam.x, cam.y, cam.z), yaw: r2(cam.yaw * 1000) / 1000, pitch: r2(cam.pitch * 1000) / 1000, fov: r2((cam.fovY * 180) / Math.PI),
    eye: point(own.x, own.y + eye, own.z), look: [r2(app.controls.yaw * 1000) / 1000, r2(app.controls.pitch * 1000) / 1000],
    third: app.view.thirdPerson, orbit: app.orbit.inUse, driving: s.driving >= 0 ? (s.registry.ids[s.bodyKind] ?? "") : "",
  };
}

/** What the crosshair is on, by the ray the app cast this frame, and where the ray met it. */
export function aimOf(app: App, kit: NotesKit): Report["aim"] {
  const pick = pickLook(app, kit, emptyPick()), out: NonNullable<Report["aim"]> = { what: pick.what };
  if (pick.what === "none") return out;
  const s = app.session, d = app["aim"], eye = app["eye"] < 0 ? 0 : app["eye"], own = s.own, manifest = app.scene?.assets.manifest;
  Object.assign(out, {
    id: pick.id, distance: r2(pick.distance), hit: point(own.x + d[0]! * pick.distance, own.y + eye + d[1]! * pick.distance, own.z + d[2]! * pick.distance),
    water: pick.water, mesh: pick.mesh, meshId: pick.mesh >= 0 ? (manifest?.meshes[pick.mesh]?.id ?? "") : "", wanted: pick.wanted, shown: pick.shown,
    material: pick.material, materialId: pick.material >= 0 ? (manifest?.materials?.[pick.material]?.id ?? "") : "", body: pick.body,
  });
  return out;
}

/** The hour the sky shows, the sun's way, the light and the fog, as the frame `p` was drawn. */
export function skyOf(app: App, p: FramePacket): Report["sky"] {
  return { hour: Math.round(app.sky.hour * 10000) / 10000, sun: [p.frame[FRAME_SUN]!, p.frame[FRAME_SUN + 1]!, p.frame[FRAME_SUN + 2]!].map((v) => Math.round(v * 1000) / 1000) as Point, light: r2(p.light), fog: [Math.round(p.fogStart), Math.round(p.fogEnd)] };
}

/** The page: the browser, the card, the canvas in device pixels and in points, the tier, the governor and the scene's share. */
export function pageOf(app: App, p: FramePacket, about: { browser: string; card: string; format: string }, canvas: readonly number[], css: readonly number[]): Report["page"] {
  return {
    browser: about.browser, card: about.card, dpr: app.dpr, canvas: [canvas[0]!, canvas[1]!], css: [css[0]!, css[1]!], tier: p.tier.name,
    governor: { level: app.governor.level, name: app.governor.level > 0 ? app.governor.name : "" }, share: r2(p.share), format: about.format, fps: Math.round(app.fps),
  };
}

/** The settings that change what is drawn and sent. */
export function settingsOf(app: App): Report["settings"] {
  const s = app.ui.settings;
  return { fov: s.fov, resolution: s.resolution, steady: s.steady, finishGloss: s.finishGloss, roadFinish: s.roadFinish, thirdPerson: s.thirdPerson, snapshotBytes: s.snapshotBytes };
}

/** The survivor: alive or not, its kind, its movement mode, what is in its hand, and what it drives. */
export function survivorOf(app: App): Report["survivor"] {
  const s = app.session, reg = s.registry, inv = s.inventory;
  const held = inv && inv.hotbar >= 0 && s.held >= 0 ? (reg.ids[inv.item[inv.hotbar + s.held]!] ?? "") : "";
  return { alive: s.sessionState === SESSION_ALIVE, kind: reg.ids[s.ownKind] ?? "", mode: s.own.mode, held, driving: s.driving >= 0 ? (reg.ids[s.bodyKind] ?? "") : "" };
}

/** A movement mode in words. */
export const modeName = (mode: number): string => MODE_NAMES[mode] ?? String(mode);
