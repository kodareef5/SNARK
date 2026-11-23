// A whole client on the harness: the app a browser runs, its interface and the frames it would draw, at a window's size.
// And an interface alone (`direct`): built from its models as the app builds it, with no server and no client.

import { App } from "../../client/core/app.ts";
import { HudModel } from "../../client/core/hud.ts";
import { IMAGE_MAP, IMAGE_MINIMAP, MINIMAP_SIZE, type Marker } from "../../client/core/hud/minimap.ts";
import type { FramePacket } from "../../client/core/render/packet.ts";
import { ClientSession } from "../../client/core/session.ts";
import { Chart } from "../../client/core/tactical.ts";
import { TouchPlay } from "../../client/core/touch.ts";
import { IMAGE_ARROW, arrowSheet } from "../../client/core/ui/arrow.ts";
import { canvasHeight, type UiFrame, type UiImage, type UiNode } from "../../client/core/ui/nodes.ts";
import * as touchLayout from "../../client/core/ui/touch.ts";
import { Ui } from "../../client/core/ui/ui.ts";
import { LoopbackNet, type LinkOptions } from "../../shared/net/loopback.ts";
import { Harness, testKey } from "../fixtures/net.ts";
import { corePack } from "../fixtures/pack.ts";
import { coreRegistry, flatWorld } from "../fixtures/world.ts";

export interface Screen {
  readonly app: App;
  /** The window, in CSS pixels. */
  width: number;
  height: number;
  /** The last frame the app built, as the shell would draw it. Null until the first. */
  packet: FramePacket | null;
}

/** Four window shapes an interface must fit: a desktop, an ultrawide, and a phone on its side and upright. */
export const WINDOWS: readonly (readonly [name: string, width: number, height: number])[] = [
  ["a desktop", 1280, 720],
  ["an ultrawide", 2560, 1080],
  ["a phone on its side", 844, 390],
  ["a phone upright", 390, 844],
];

/** A harness whose clients with a screen build a frame each time theirs comes, as a browser's do. */
export class ScreenHarness extends Harness {
  readonly screens = new Map<ClientSession, Screen>();

  /** Joins a client that runs the whole app. Its keys and look are the app's controls. */
  open(name: string, link: LinkOptions = {}): ClientSession {
    const session = this.join(name, link, { manual: true });
    this.screens.set(session, { app: new App(session, this.reg, corePack()), width: 1280, height: 720, packet: null });
    return session;
  }

  override run(ms: number, eachFrame?: (now: number) => void): void {
    if (this.screens.size === 0) return super.run(ms, eachFrame);
    super.run(ms, (now) => {
      for (const view of this.screens.values()) view.packet = view.app.frame(now, view.width, view.height) ?? view.packet;
      eachFrame?.(now);
    });
  }
}

/** The screen of a survivor joined with `screen: true`. */
export function screen(h: Harness, s: ClientSession): Screen {
  const view = h instanceof ScreenHarness ? h.screens.get(s) : undefined;
  if (!view) throw new Error(`${s.name} has no screen: join it with { screen: true }`);
  return view;
}

/** Presses a key and lets it go, by its code as a browser names it: "KeyE", "Tab", "Digit1". */
export function tap(h: Harness, view: Screen, code: string): void {
  view.app.key(code, true);
  h.run(100);
  view.app.key(code, false);
  h.run(100);
}

/** Gives the window another size and builds a frame at it. */
export function resize(h: Harness, view: Screen, width: number, height: number): void {
  view.width = width;
  view.height = height;
  h.run(100);
}

/** The interface's node with a key (a KEY_ constant of client/core/ui), or null if it is not on the screen. */
export function node(view: Screen, key: number): UiNode | null {
  return view.app.ui.frame.find(key);
}

/** The text the interface shows at a key, or null if it is not on the screen. */
export function shown(view: Screen, key: number): string | null {
  return node(view, key)?.text ?? null;
}

/** Whether a node lies wholly inside the interface's frame. */
export function fits(view: Screen, key: number): boolean {
  const n = node(view, key);
  const f = view.app.ui.frame;
  return n !== null && n.x >= 0 && n.y >= 0 && n.x + n.w <= f.width && n.y + n.h <= f.height;
}

/** How many of a mesh the last frame draws: "core:raptor", "core:wall". */
export function drawn(view: Screen, mesh: string): number {
  const p = view.packet;
  const k = corePack().meshIndex.get(mesh);
  if (k === undefined) throw new Error(`the pack has no mesh called ${mesh}`);
  let n = 0;
  for (let d = 0; p && d < p.drawCount; d++) if (p.drawMesh[d] === k) n += p.drawInstances[d]!;
  return n;
}

/** A phone's or a tablet's window in CSS pixels, and the edges its screen takes: left, top, right, bottom. */
export type Phone = readonly [name: string, width: number, height: number, insets: readonly number[]];

/** Nine windows a finger plays in, either way up. */
export const PHONES: readonly Phone[] = [
  ["a phone on its side", 844, 390, [47, 0, 47, 21]],
  ["a small phone on its side", 667, 375, [0, 0, 0, 0]],
  ["the smallest phone on its side", 568, 320, [0, 0, 0, 0]],
  ["a phone upright", 390, 844, [0, 47, 0, 34]],
  ["a small phone upright", 375, 667, [0, 20, 0, 0]],
  ["a tall narrow phone upright", 360, 800, [0, 32, 0, 24]],
  ["the smallest phone upright", 320, 568, [0, 20, 0, 0]],
  ["a tablet", 1024, 768, [0, 24, 0, 20]],
  ["a tablet upright", 768, 1024, [0, 24, 0, 20]],
];

/** What a survivor's play sets that the interface's build reads: `direct` sets them on new models. */
export interface Stood {
  readout: readonly string[];
  clock: string;
  food: number;
  water: number;
  /** Degrees clockwise from north, as the compass shows it. */
  heading: number;
  /** The map's markers, the survivor's own first: places on the map's picture, 0..1 east and south. */
  markers: readonly Marker[];
  /** The view is from behind the body, so no crosshair is drawn. */
  behind: boolean;
  /** Slots of its hotbar, all empty. */
  slots: number;
}

/** A survivor new to the harness's field: where it spawns facing north, at nine in the morning, fed, nothing in hand. */
export const STOOD: Stood = {
  readout: ["7.7 lat  7.5 lon  N 0", "x 256.0  y 0.0  z 240.0  0.0 m/s", "60 fps  67 ms  0 corrections  0 nearby"],
  clock: "09:00", food: 1, water: 1, heading: 0, markers: [{ kind: "self", u: 0.5, v: 0.53125, tint: -1 }], behind: true, slots: 10,
};

/** What a running app's survivor has set of them. */
export function stood(app: App): Stood {
  const m = app.hud;
  return { readout: [...m.readout], clock: m.clock, food: m.vitals[2]!.fraction, water: m.vitals[3]!.fraction, heading: m.dial.shown, markers: m.markers.map((k) => ({ ...k })), behind: m.behind, slots: m.hotbar.length };
}

/** An interface with no client behind it. Set `ui` and `hud` to the state wanted, then `build`. */
export interface Direct {
  readonly ui: Ui;
  readonly hud: HudModel;
  /** A session that never met a server: the interface plays over it and asks it nothing. */
  readonly session: ClientSession;
  /** The window, in CSS pixels, and the edges its screen takes. */
  width: number;
  height: number;
  insets: readonly number[];
  /** Builds the interface at the window, as App.frame does, and returns its frame. */
  build(): UiFrame;
}

/** Made once: a flat map for the minimap's picture, and the sheet of arrows. */
let flat: ReturnType<typeof flatWorld> | null = null;
let arrows: UiImage | null = null;

/**
 * The interface of a survivor standing in the world, from models alone. `finger` plays it by touch, with the touch
 * layer's layout at hand.
 */
export function direct(width: number, height: number, insets: readonly number[] = [0, 0, 0, 0], opts: { finger?: boolean; as?: Stood } = {}): Direct {
  const ui = new Ui(), hud = new HudModel(), reg = coreRegistry(), pack = corePack(), as = opts.as ?? STOOD;
  ui.registry = reg;
  ui.palette = pack.palette;
  ui.touchPlay = new TouchPlay();
  if (opts.finger) { ui.inputDevice = 2; ui.layer = touchLayout; }
  hud.readout.splice(0, Infinity, ...as.readout);
  hud.clock = as.clock;
  hud.vitals[2]!.fraction = as.food;
  hud.vitals[3]!.fraction = as.water;
  hud.dial.shown = as.heading;
  hud.behind = as.behind;
  for (let i = 0; i < as.slots; i++) hud.hotbar.push({ label: "", tint: -1, number: "", id: "" });
  hud.markers.push(...as.markers.map((k) => ({ ...k })));
  const chart = (hud.chart = new Chart((flat ??= flatWorld()).hf, pack.palette)), self = as.markers[0]!;
  ui.frame.images[IMAGE_MINIMAP] = chart.mini.image;
  ui.frame.images[IMAGE_MAP] = chart.full.image;
  ui.frame.images[IMAGE_ARROW] = arrows ??= arrowSheet();
  const session = new ClientSession(new LoopbackNet().connect(), { name: "nobody", key: testKey("nobody"), registry: reg, resolveMap: () => null });
  const view: Direct = {
    ui, hud, session, width, height, insets,
    build() {
      const units = canvasHeight(view.width, view.height), unit = Math.max(view.height, 1) / units, f = ui.frame;
      ui.canvasHeight = units;
      f.unit = unit;
      f.left = view.insets[0]! / unit; f.top = view.insets[1]! / unit; f.right = view.insets[2]! / unit; f.bottom = view.insets[3]! / unit;
      chart.drawMini(null, 0, self.u, self.v, Math.max(64, Math.min(512, Math.round(MINIMAP_SIZE * unit))), true);
      ui.build(view.width / Math.max(view.height, 1), hud, session);
      return f;
    },
  };
  return view;
}

/** A frame's nodes as text, one each, to compare two frames exactly. */
export function nodes(f: UiFrame): string[] {
  return f.nodes.slice(0, f.count).map((n) => JSON.stringify(n));
}
