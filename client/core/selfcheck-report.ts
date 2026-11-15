// Native self-check decisions and report assembly. The shell supplies platform observations only.
import type { Pack } from "../../shared/pack/pack.ts";
import type { Manifest } from "../../shared/pack/manifest.ts";
import { LEVEL_COLOURS, SKY_COLOR } from "../../shared/pack/palette.ts";
import type { Heightfield } from "../../shared/world/heightfield.ts";
import type { App } from "./app.ts";
import type { AssetPort } from "./assets/port.ts";
import type { FramePacket } from "./render/packet.ts";
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
  audio: object;
  restored: number;
  misplaced: number;
  cache: AssetPort["cache"];
  userAgent: string;
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
  const probes = [...provingProbes(app.cam, reg, pack.palette, SKY_COLOR, hf, o.has("creature"), packet), ...stressed].map((p) => {
    const got = renderer.readPixel(p.sx, p.sy);
    return { name: p.name, expected: heldTo(p, got[0], got[1], got[2]), got, ok: probePasses(p, got[0], got[1], got[2]) };
  });
  times.sort((x, y) => x - y);
  const misplaced = o.misplaced;
  const urban = o.has("urban") ? (() => {
    const drawn = Array.from(packet.drawMesh.subarray(0, packet.drawCount), index => manifest.meshes[index]?.id ?? "");
    const vehicles = drawn.filter(id => id.startsWith("core:compact"));
    const humans = drawn.filter(id => id.startsWith("core:human"));
    const seats = Array.from(app.remote.seatSlot.subarray(0, app.remote.count)).filter(slot => slot > 0);
    const driving = drive ? { ...drive, ownKind: reg.ids[session.own.kind], audio: { ...o.audio }, ok: !drive.timedOut && drive.maxSpeed > 3 && drive.hud && session.driving >= 0 } : null;
    return { vehicles, humans, seats, ownKind: reg.ids[session.own.kind], ...(driving ? { driving } : {}), ok: vehicles.length > 0 && humans.length > 0 && seats.length > 0 && renderer.errors === 0 && (!driving || driving.ok) };
  })() : null;
  return {
    // A listening page has the talking page's body in view, so its picture is not the fixed one and the probes do not count.
    ok: (driveCheck || voiceListen || probes.every((p) => p.ok)) && (!urban || urban.ok) && misplaced === 0 && heard && restored === (o.has("lose") ? 1 : 0) && packet.skipped === 0 && packet.dropped === 0 && stressed.length === (app.stress ? 3 : 0) && rocks.every((m) => m.drawn === m.level),
    ...(urban ? { urban } : {}),
    rocks: rocks.map((m) => [m.level, m.drawn]),
    restored,
    assets: { ...app.scene?.assets.residency.stats, kept: o.cache },
    ...(voiced ? { voice: o.voice } : {}),
    userAgent: o.userAgent,
    renderer: renderer.rendererName,
    textures: { format: renderer.format, takes: renderer.formats, errors: renderer.errors },
    canvas: [width, height],
    probes,
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
