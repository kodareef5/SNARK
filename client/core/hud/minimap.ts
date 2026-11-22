// The minimap in the top right and the markers the maps show: the reader, its tribe, deaths, drops, and what is in view.
// The model's pictures are the chart's (client/core/tactical.ts); the map screen draws the same markers (ui/screens.ts).

import { CMD_MAP_ZOOM, SESSION_DEAD } from "../../../shared/net/protocol.ts";
import { formatHour, hourOfDay } from "../../../shared/sim/clock.ts";
import { mapU, mapV } from "../../../shared/world/coords.ts";
import type { Heightfield } from "../../../shared/world/heightfield.ts";
import { MARK_MATE, MARK_OTHER, MARK_SPOT, MARK_TAME, MAX_MARKS, PLAYERS_OFF, type Marks } from "../../../shared/world/tactical.ts";
import type { ClientSession, RemoteSample } from "../session.ts";
import type { Chart } from "../tactical.ts";
import { IMAGE_ARROW, arrowSheet, placeArrow } from "../ui/arrow.ts";
import { K_BUTTON, K_IMAGE, K_PANEL } from "../ui/nodes.ts";
import { glass } from "../ui/skin.ts";
import { S_FRAME, S_HUD_HIT, S_LABEL, S_MARK_CREATURE, S_MARK_DEATH, S_MARK_PLAYER, S_MARK_SELF, S_MARK_SPAWN } from "../ui/style.ts";
import { SPOT_INK } from "./marks.ts";
import type { HudWidget } from "./widget.ts";

/** One of the reader's tribe is a mate and one of its creatures a tame. A player is a survivor of another tribe, and a creature is not the tribe's. */
export type MarkerKind = "self" | "mate" | "tame" | "death" | "spawn" | "player" | "creature" | "drop" | "dropPip" | "spotted";

export interface Marker {
  /** A "drop" is a supply drop the server's drop book tells of on the map, and a "dropPip" one it tells of on the compass alone. */
  kind: MarkerKind;
  /** 0xRRGGBB of its own, or none for its kind's: a drop's is its tier's. */
  tint?: number;
  /** Where on the map's picture, 0..1 east and south from its north-west corner (mapU, mapV). */
  u: number;
  v: number;
}

/** The most markers a map shows. The model lists the most important first, and what is past this is left out. */
export const MAX_MARKERS = 256;
/** The minimap's side, in units of the interface. */
export const MINIMAP_SIZE = 160;
/** Metres. A mark this near a body of its kind in view is that body, which is drawn from the view. */
const SAME_BODY = 16;
/** Bits of the replicated entity flags. */
const VIEW_FLAG_PLAYER = 4;
const VIEW_FLAG_PROP = 8;

export const KEY_MINIMAP_FRAME = 10;
export const KEY_MINIMAP = 11;
export const KEY_CLOCK = 12;
export const KEY_MINIMAP_TOGGLE = 5390;
export const KEY_MINIMAP_OUT = 5391;
export const KEY_MINIMAP_IN = 5392;
/** One mark for each marker on the minimap, MAX_MARKERS at most. */
export const KEY_MARKER = 4000;
/** The reader's arrow on the minimap. */
export const KEY_SELF_ARROW = 6590;
/** The arrow's side on a minimap MINIMAP_SIZE across. */
const ARROW_SIZE = 24;
/** Indices of the minimap's picture and the map screen's in the frame's image table. */
export const IMAGE_MINIMAP = 1;
export const IMAGE_MAP = 2;
export const MARKER_STYLE: Record<MarkerKind, number> = { self: S_MARK_SELF, mate: S_MARK_SELF, tame: S_MARK_SELF, player: S_MARK_PLAYER, creature: S_MARK_CREATURE, spawn: S_MARK_SPAWN, death: S_MARK_DEATH, drop: S_MARK_SELF, dropPip: S_MARK_SELF, spotted: S_MARK_CREATURE };
/** Colours of the kinds that have no style of their own. */
export const MARKER_TINT: Partial<Record<MarkerKind, number>> = { mate: 0x6fd0ff, tame: 0xe8d24a, spotted: SPOT_INK };

export interface MinimapModel {
  /** The most important first: the reader, mates, tames, deaths, other survivors, then creatures in view. */
  markers: Marker[];
  /** How many more the last update had than a map shows. They were the least important. */
  unmarked: number;
  pool: Marker[];
  /** The map's pictures and where they look. Null until the app has the world, and then both screens show the whole map. */
  chart: Chart | null;
  minimapVisible: boolean;
  /** `mapSeen` is the update (StateModel.frames) during which the map screen was last built. */
  mapSeen: number;
  /** The map screen's picture on the canvas, and the place last pointed at on it as shares of the map's picture, or -1. */
  mapBox: { x: number; y: number; size: number };
  pointedU: number;
  pointedV: number;
  /** The tick at which the server was last told the zoom, the marks last compared with the view, and which of them are bodies in view. */
  zoomAsked: number;
  marksSeen: number;
  inView: Uint8Array;
  /** Time of day, "06:30". */
  clock: string;
}

/** Adds a marker at (x, z), unless the map has all it shows. */
export function mark(model: MinimapModel, kind: MarkerKind, hf: Heightfield, x: number, z: number, tint = -1): void {
  const n = model.markers.length;
  if (n >= MAX_MARKERS) {
    model.unmarked++;
    return;
  }
  const m = (model.pool[n] ??= { kind, u: 0, v: 0, tint: -1 });
  m.kind = kind;
  m.tint = tint;
  m.u = mapU(hf, x);
  m.v = mapV(hf, z);
  model.markers.push(m);
}

/**
 * Whether mark `i` is a body the view holds, which is then drawn from the view, where it moves every frame. The marks
 * carry no names, so a mark is taken for a body of its kind standing within SAME_BODY of it. Worked out once for each
 * message of marks.
 */
export function seenInView(model: MinimapModel, marks: Marks, i: number, remote: RemoteSample, team: number): boolean {
  if (marks.version !== model.marksSeen) {
    model.marksSeen = marks.version;
    for (let k = 0; k < marks.count; k++) {
      const kind = marks.kind[k]!;
      let found = 0;
      for (let j = 0; j < remote.count && found === 0; j++) {
        const player = (remote.flags[j]! & VIEW_FLAG_PLAYER) !== 0;
        const mine = team !== 0 && remote.team[j] === team;
        if ((remote.flags[j]! & VIEW_FLAG_PROP) !== 0 || (kind === MARK_MATE ? !player || !mine : kind === MARK_TAME ? player || !mine : !player || mine)) continue;
        const dx = remote.x[j]! - marks.x[k]!;
        const dz = remote.z[j]! - marks.z[k]!;
        if (dx * dx + dz * dz < SAME_BODY * SAME_BODY) found = 1;
      }
      model.inView[k] = found;
    }
  }
  return model.inView[i] === 1;
}

/** Marks the bodies in view that are survivors or not, and the reader's tribe's or not. */
function markView(model: MinimapModel, hf: Heightfield, remote: RemoteSample, team: number, player: boolean, mine: boolean, kind: MarkerKind): void {
  for (let i = 0; i < remote.count; i++) {
    const f = remote.flags[i]!;
    if ((f & VIEW_FLAG_PROP) === 0 && ((f & VIEW_FLAG_PLAYER) !== 0) === player && (team !== 0 && remote.team[i] === team) === mine) mark(model, kind, hf, remote.x[i]!, remote.z[i]!);
  }
}

/** Marks the server's marks of one kind, but for the reader's own and those that are bodies in view. */
function markFar(model: MinimapModel, hf: Heightfield, marks: Marks, remote: RemoteSample, team: number, from: number, kind: MarkerKind): void {
  for (let i = 0; i < marks.count; i++) if (marks.kind[i] === from && i !== marks.self && !seenInView(model, marks, i, remote, team)) mark(model, kind, hf, marks.x[i]!, marks.z[i]!);
}

/** Fills the model's markers, the most important first. Friends in view come from the view, and those beyond it from the server's marks. */
function fillMarkers(model: MinimapModel, session: ClientSession, remote: RemoteSample): void {
  const hf = session.world!.hf;
  const team = session.tribe.team;
  const marks = session.tactical.marks;
  model.markers.length = 0;
  model.unmarked = 0;
  // A server rule can hide the reader's own position.
  if (session.mapLocation) mark(model, "self", hf, session.own.x, session.own.z);
  markView(model, hf, remote, team, true, true, "mate");
  markFar(model, hf, marks, remote, team, MARK_MATE, "mate");
  markView(model, hf, remote, team, false, true, "tame");
  markFar(model, hf, marks, remote, team, MARK_TAME, "tame");
  // What the tribe spotted through a glass (D1082), in view or not.
  for (let i = 0; i < marks.count; i++) if (marks.kind[i] === MARK_SPOT) mark(model, "spotted", hf, marks.x[i]!, marks.z[i]!);
  for (const m of session.markers) mark(model, "death", hf, m.x, m.z);
  // Supply drops, where the server's drop book tells of them: on the compass, or on the compass and the map.
  for (const d of session.supply.rows) if (d.left === 0 && d.announce > 0) mark(model, d.announce > 1 ? "drop" : "dropPip", hf, d.x, d.z, session.supply.tiers[d.tier]?.rgb ?? -1);
  // Beds and spawn points, while one is being chosen.
  if (session.sessionState === SESSION_DEAD) for (const p of session.respawnPoints) mark(model, "spawn", hf, p.x, p.z);
  // Survivors of other tribes: those the server marks, and those in view if its rule lets them show.
  markFar(model, hf, marks, remote, team, MARK_OTHER, "player");
  if (marks.players !== PLAYERS_OFF) markView(model, hf, remote, team, true, false, "player");
  markView(model, hf, remote, team, false, false, "creature");
}

export const MINIMAP: HudWidget<MinimapModel> = {
  name: "minimap",
  make: () => ({ markers: [], unmarked: 0, pool: [], chart: null, minimapVisible: true, mapSeen: -2, mapBox: { x: 0, y: 0, size: 1 }, pointedU: -1, pointedV: -1, zoomAsked: -1000, marksSeen: -1, inView: new Uint8Array(MAX_MARKS), clock: "" }),
  fill(model, c) {
    const session = c.session, world = session.world!, b = session.own, scale = c.scale, a = c.frame;
    if (a) {
      model.minimapVisible = a.settings.minimap && !a.menu;
      if (model.chart && a.settings.minimapZoom >= 0) model.chart.miniZoom = a.settings.minimapZoom;
    }
    fillMarkers(model, session, c.remote);
    const chart = model.chart;
    if (chart) {
      chart.tiles.step();
      if (model.minimapVisible) chart.drawMini(session.tactical, session.tribe.team, mapU(world.hf, b.x), mapV(world.hf, b.z), Math.max(64, Math.min(512, Math.round(MINIMAP_SIZE * scale))), session.mapLocation);
      // The server sends structure cells at the size that suits the finest zoom on show. Its marks say which zoom it holds, so a
      // request that was lost or refused is made again.
      const want = Math.max(model.minimapVisible ? chart.mini.view.zoom : 0, model.mapSeen === model.frames - 1 ? chart.fullZoom : 0);
      if (want !== session.tactical.marks.zoom && session.simTick - model.zoomAsked >= 45 && session.command(CMD_MAP_ZOOM, (w) => w.bits(want, 2)) !== 0) model.zoomAsked = session.simTick;
    }
    model.clock = formatHour(hourOfDay(session.latestSnapshot, session.dayOffset, session.clock));
  },
  build(f, m, at) {
    const { options, inspect, MAP, mapX, mapY, mapTools } = at;
    if (options.minimap) {
      const mapTop = mapY;
      glass(f, KEY_MINIMAP_FRAME, mapX - 2, mapTop - 2, MAP + 4, MAP + 4);
      const picture = f.add(KEY_MINIMAP, K_IMAGE, mapX, mapTop, MAP, MAP, S_FRAME);
      picture.image = IMAGE_MINIMAP;
      picture.alpha = .82;
      // The minimap is a window on the map, and its markers are put on its picture. The model lists the most important marker
      // first, so drawing from the last keeps those on top.
      const view = m.chart?.mini.view;
      let shown = 0;
      for (let i = Math.min(m.markers.length, MAX_MARKERS) - 1; view && i >= 0; i--) {
        const k = m.markers[i]!;
        const u = (k.u - view.u0) / view.du;
        const v = (k.v - view.v0) / view.dv;
        if (u < 0 || u > 1 || v < 0 || v > 1) continue;
        const x = mapX + Math.max(2, Math.min(MAP - 2, u * MAP)), y = mapTop + Math.max(2, Math.min(MAP - 2, v * MAP));
        // The reader is an arrow the way it faces, on top of the rest.
        if (k.kind === "self") {
          const side = Math.round((ARROW_SIZE * MAP) / MINIMAP_SIZE);
          f.images[IMAGE_ARROW] ??= arrowSheet();
          placeArrow(f.add(KEY_SELF_ARROW, K_IMAGE, x - side / 2, y - side / 2, side, side, S_FRAME), m.dial.heading);
          continue;
        }
        // A drop told of on the compass alone is not on the map, the small one either.
        if (k.kind === "dropPip") continue;
        f.add(KEY_MARKER + shown++, K_PANEL, x - 2, y - 2, 4, 4, MARKER_STYLE[k.kind]).tint = (k.tint ?? -1) >= 0 ? k.tint! : (MARKER_TINT[k.kind] ?? -1);
      }
      if (inspect || options.diagnostics) f.text(KEY_CLOCK, mapX, mapTop + MAP + 4, MAP, S_LABEL, m.clock);
      if (mapTools) for (let i = 0; i < 2; i++) {
        const b = f.add(KEY_MINIMAP_OUT + i, K_BUTTON, mapX + i * 36, mapY + MAP - 32, 32, 32, S_HUD_HIT);
        b.text = i === 0 ? "−" : "+";
        b.label = i === 0 ? "Zoom out" : "Zoom in";
        b.interactive = true;
      }
    }
  },
};

/** The button that hides and shows the minimap, over the compass. */
export const MINIMAP_TOGGLE: HudWidget = {
  name: "minimap toggle",
  build(f, _m, at) {
    const { options, dash, dashW, right, MAP, mapY, mapTools } = at;
    if (mapTools) {
      const beside = dash && !options.minimap ? dashW + 4 : 0;
      const toggle = f.add(KEY_MINIMAP_TOGGLE, K_BUTTON, right - 32 - beside, mapY + (options.minimap ? MAP - 32 : 0), 32, 32, S_HUD_HIT);
      toggle.text = "◇";
      toggle.label = options.minimap ? "Hide minimap" : "Show minimap";
      toggle.interactive = true;
    }
  },
};
