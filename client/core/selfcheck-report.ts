// Native self-check decisions and report assembly. The shell supplies platform observations only.
import { SURFACE_PREFIX } from "../../content/surfaces.ts";
import type { Pack } from "../../shared/pack/pack.ts";
import type { Manifest } from "../../shared/pack/manifest.ts";
import { LEVEL_COLOURS, SKY_COLOR } from "../../shared/pack/palette.ts";
import type { Heightfield } from "../../shared/world/heightfield.ts";
import type { App } from "./app.ts";
import type { AssetPort } from "./assets/port.ts";
import type { FramePacket } from "./render/packet.ts";
import { NO_REFERENCE, type SelfcheckSurfaces } from "./selfcheck-surfaces.ts";
import type { DinosaurSelfcheck } from "./activity-selfcheck.ts";
import type { VehicleSelfcheck } from "./vehicle-selfcheck.ts";
import { probeProgress } from "./diagnostics.ts";
import { heldTo, probePasses, provingProbes, type Probe } from "./selfcheck.ts";

/** Keep the existing frame/cache/voice deadlines in core; platform code only supplies observations. */
export class SelfcheckProgress {
  frames = 0;
  still = 0;
  readonly times: number[] = [];
  private keptBefore = 0;

  advance(ms: number, kept: number, enabled: boolean, voiced: boolean, played: number, driveFinished: boolean): boolean {
    this.times.push(ms);
    this.still = kept === this.keptBefore ? this.still + 1 : 0;
    this.keptBefore = kept;
    if (!enabled || this.frames < 0 || ++this.frames < 90 || this.still < 30 || !driveFinished || (voiced && played < 50 && this.frames < 690)) return false;
    this.frames = -1;
    return true;
  }
}

export interface SelfcheckObservations {
  has(name: string): boolean;
  voiced: boolean;
  voiceListen: boolean;
  voice: { played: number; odd: number; errors: number; heard: readonly string[] };
  driveCheck: boolean;
  drive: VehicleSelfcheck["data"] | undefined;
  dinosaur?: DinosaurSelfcheck["data"];
  restored: number;
  misplaced: number;
  /** The loudest the world's sound got, when the page has sound. */
  sound: { peak: number } | null;
  cache: AssetPort["cache"];
  userAgent: string;
  surfaces?: Pick<SelfcheckSurfaces, "sample" | "state"> | null;
  width: number;
  height: number;
  times: number[];
  renderer: {
    readPixel(sx: number, sy: number): [number, number, number];
    errors: number; rendererName: string; format: string; formats: readonly string[]; drawCalls: number;
  };
}

export function selfcheckReport(app: App, pack: Pack, manifest: Manifest, hf: Heightfield, packet: FramePacket, o: SelfcheckObservations) {
  const session = app.session, reg = session.registry;
  const { voiced, voiceListen, driveCheck, drive, restored, renderer, width, height, times } = o;
  const heard = !voiced || (o.voice.played >= 50 && o.voice.odd === 0 && o.voice.errors === 0 && (!voiceListen || o.voice.heard.length > 0));
  // In the stress scene three rocks hang in the sky, each drawn at another level, and a level is all one colour.
  const rocks = app.marks.map((m) => ({ ...m, drawn: app.scene!.things[m.thing]!.level }));
  const at = [0, 0, 0];
  const stressed = rocks.flatMap((m): Probe[] => (app.cam.project(m.x, m.y, m.z, at) ? [{ name: `rock at level ${m.level}`, sx: at[0]!, sy: at[1]!, rgb: [0, 1, 2].map((c) => pack.palette[LEVEL_COLOURS[m.level]! * 4 + c]!) as Probe["rgb"], mode: "hue" }] : []));
  const paletteOnly = !manifest.materials?.some((m) => m.id.startsWith(SURFACE_PREFIX));
  const survivor = reg.defs[reg.index.get("core:survivor") ?? 0];
  const mannequin = app.scene?.assets.bind.id("core:survivor", "body", "m/torso") === "core:mannequin/torso";
  const mannequinColor = mannequin && survivor?.type === "species" ? survivor.color : undefined;
  const probes = [...provingProbes(app.cam, reg, pack.palette, SKY_COLOR, hf, o.has("creature"), packet, { width, height, paletteOnly, sample: o.surfaces?.sample ?? null }, mannequinColor), ...stressed].map((p) => {
    const got = renderer.readPixel(p.sx, p.sy);
    return { name: p.name, expected: heldTo(p, got[0], got[1], got[2]), got, ok: probePasses(p, got[0], got[1], got[2]) };
  });
  times.sort((x, y) => x - y);
  const misplaced = o.misplaced;
  const urban = o.has("urban") ? (() => {
    const drawn = Array.from(packet.drawMesh.subarray(0, packet.drawCount), index => manifest.meshes[index]?.id ?? "");
    const vehicleMeshes = new Set(reg.defs.flatMap(d => d?.type === "species" && d.vehicle ? [d.mesh] : []));
    const vehicles = drawn.filter(id => vehicleMeshes.has(id));
    const humans = drawn.filter(id => id.startsWith("core:human") || (mannequin && id.startsWith("core:mannequin/")));
    const seats = Array.from(app.remote.seatSlot.subarray(0, app.remote.count)).filter(slot => slot > 0);
    const driving = drive ? { ...drive, ownKind: reg.ids[session.own.kind], ok: !drive.timedOut && drive.maxSpeed > 3 && drive.hud && session.driving >= 0 } : null;
    return { vehicles, humans, seats, ownKind: reg.ids[session.own.kind], ...(driving ? { driving } : {}), ok: vehicles.length > 0 && humans.length > 0 && seats.length > 0 && renderer.errors === 0 && (!driving || driving.ok) };
  })() : null;
  const dinosaur = o.dinosaur ? (() => {
    const d = o.dinosaur!, drawn = Array.from(packet.drawMesh.subarray(0, packet.drawCount), index => manifest.meshes[index]?.id ?? "");
    const body = drawn.includes(d.species), rider = drawn.some(id => id.startsWith("core:human"));
    const combat = reg.combat[session.own.kind], modes = combat?.modes;
    return { ...d, body, rider, ownKind: reg.ids[session.own.kind], ok: d.finished && !d.timedOut && !d.lostMount && d.mounted && d.primary && d.secondary && (!combat?.charge || d.chargeRan && d.recovered) && (!modes || d.switched) && d.maxSpeed > 1 && d.distance > 3 && d.cameraFinite && body && rider && reg.ids[session.own.kind] === d.species && renderer.errors === 0 };
  })() : null;
  return {
    // A listening page has the talking page's body in view, so its picture is not the fixed one and the probes do not count.
    ok: (!packet.lit || paletteOnly || !!o.surfaces?.sample) && (driveCheck || dinosaur !== null || voiceListen || probes.every((p) => p.ok)) && (!urban || urban.ok) && (!dinosaur || dinosaur.ok) && misplaced === 0 && heard && restored === (o.has("lose") ? 1 : 0) && packet.skipped === 0 && packet.dropped === 0 && stressed.length === (app.stress ? 3 : 0) && rocks.every((m) => m.drawn === m.level) && (!app.sounds?.library.index.has("core:dodo/sound/call") || (o.sound?.peak ?? 0) > 0.001),
    ...(urban ? { urban } : {}),
    ...(dinosaur ? { dinosaur } : {}),
    rocks: rocks.map((m) => [m.level, m.drawn]),
    restored,
    assets: { ...app.scene?.assets.residency.stats, kept: o.cache },
    ...(voiced ? { voice: o.voice } : {}),
    ...(app.sounds ? { sound: { line: app.sounds.line(), peak: o.sound?.peak ?? 0 } } : {}),
    userAgent: o.userAgent,
    renderer: renderer.rendererName,
    textures: { format: renderer.format, takes: renderer.formats, errors: renderer.errors },
    canvas: [width, height],
    probes,
    ...(packet.lit && !paletteOnly ? { surfaceReference: o.surfaces?.state ?? NO_REFERENCE } : {}),
    interface: { nodes: app.ui.frame.count, misplaced },
    structures: session.world!.structs.count,
    tiles: packet.tileCount,
    draws: packet.drawCount,
    entitiesDrawn: packet.transientCount,
    drawCalls: renderer.drawCalls,
    triangles: packet.triangles,
    frameMsMedian: times[times.length >> 1],
    snapshots: session.stats.snapshots,
    corrections: session.stats.corrections,
    progress: probeProgress(app),
  };
}
