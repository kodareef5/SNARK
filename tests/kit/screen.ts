// A whole client on the harness: the app a browser runs, its interface and the frames it would draw, at a window's size.

import { App } from "../../client/core/app.ts";
import type { FramePacket } from "../../client/core/render/packet.ts";
import type { ClientSession } from "../../client/core/session.ts";
import type { UiNode } from "../../client/core/ui/nodes.ts";
import type { LinkOptions } from "../../shared/net/loopback.ts";
import { Harness } from "../fixtures/net.ts";
import { corePack } from "../fixtures/pack.ts";

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
