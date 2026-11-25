// What a world tells its clients the screens play (OWN_SCREEN). Once a second, off the tick, it works out each screen's
// programme on the wall clock and turns it into world ticks; a client is sent the message only when that changes.
import { TICK_RATE } from "../../shared/coords.ts";
import { OWN_SCREEN } from "../../shared/net/protocol.ts";
import { isDay } from "../../shared/sim/clock.ts";
import { SCREENS, defaultScreen, heldSceneOf } from "../../shared/video/clip.ts";
import { onceShowing, screenAt, type Playing } from "../../shared/video/programme.ts";
import { NO_CHANNEL, NO_CLIP, SCREEN_FACING, SCREEN_FILL, SCREEN_ONCE, SCREEN_SOUND, SHOW_SCENES, SHOW_VIDEO, writeScreens, type ScreenState } from "../../shared/video/screen.ts";
import { orbOnly } from "../../shared/world/orb.ts";
import type { GameServer } from "../game.ts";
import type { Rules } from "../settings/rules.ts";
import { worldHour, type ServerWorld } from "../world.ts";
import type { LibraryView } from "./library.ts";
import type { ScreenWorld } from "./routes.ts";

/** How often the library's file is looked at for a change, in milliseconds. */
export const LIBRARY_CHECK_MS = 5000;
const SWEEP_MS = 60_000;

/** What the feed reads the library by: a stamp that changes when it may have, and the library itself. */
export interface LibrarySource {
  stamp(): string;
  view(): LibraryView;
  sweep(): void;
}

/** It is night where the sun is down: outside the hours of day on the world's clock. */
export const worldNight = (world: ServerWorld): boolean => !isDay(worldHour(world));

/** This world as its players see the ball, for the Screens page: its clock and the orb's own settings. */
export function screenWorld(host: { readonly world: ServerWorld; readonly rules: Rules }): ScreenWorld {
  return {
    night: worldNight(host.world),
    seconds: host.world.tick / TICK_RATE,
    hour: worldHour(host.world),
    only: orbOnly(host.rules.text("OrbScene")),
    gain: Math.min(4, Math.max(0, host.rules.num("OrbBrightness"))),
  };
}

/** The world tick at which a clip whose first second played at `start` (wall ms) began, seen at `tick` and `wall`. */
export const startTick = (tick: number, wall: number, start: number): number => tick - ((wall - start) / 1000) * TICK_RATE;

export class ScreenFeed {
  /** Bumped whenever what a screen shows changes, which sends every session the message. */
  version = 0;
  readonly states: ScreenState[] = [];
  private readonly lib: LibrarySource;
  private readonly world: ServerWorld;
  private view: LibraryView | null = null;
  private stamp = "";
  private checked = -Infinity;
  private swept = -Infinity;
  /** What each type played at the last poll, so its start tick holds while the same item plays, and the channel epoch whose tick it holds. */
  private readonly playing: (Playing | null)[] = [];
  private readonly epochs: number[] = [];

  constructor(lib: LibrarySource, world: ServerWorld) {
    this.lib = lib;
    this.world = world;
  }

  /** Registers OWN_SCREEN with the game, which sends it on a welcome and after each change. */
  attach(game: GameServer): void {
    game.own.add<number>({ kind: OWN_SCREEN, version: () => (this.view ? this.version : undefined), write: (w) => writeScreens(w, this.states) });
  }

  /** Reads the library if its file changed, and works out what each screen plays at `wall` ms. */
  poll(wall = Date.now(), night = worldNight(this.world)): void {
    if (wall - this.checked >= LIBRARY_CHECK_MS) {
      this.checked = wall;
      const stamp = this.lib.stamp();
      if (stamp !== this.stamp || !this.view) {
        this.stamp = stamp;
        this.view = this.lib.view();
      }
    }
    if (wall - this.swept >= SWEEP_MS) {
      this.swept = wall;
      this.lib.sweep();
    }
    const view = this.view!;
    const index = new Map(view.manifest.map((c, i) => [c.id, i]));
    let changed = this.states.length !== SCREENS.length;
    SCREENS.forEach((id, i) => {
      const screen = view.screens.get(id) ?? defaultScreen(id);
      const now = screenAt(screen, view.channels, view.timed, wall, night), was = this.playing[i] ?? null;
      const s = this.states[i] ?? (this.states[i] = { manifest: "", show: SHOW_SCENES, flags: 0, clip: NO_CLIP, start: 0, next: NO_CLIP, scene: -1, channel: NO_CHANNEL, epoch: 0 });
      const once = onceShowing(screen, view.timed, wall) && !(screen.night && !night);
      const flags = (screen.mode === "facing" ? SCREEN_FACING : 0) | (screen.fill ? SCREEN_FILL : 0) | (screen.sound ? SCREEN_SOUND : 0) | (once ? SCREEN_ONCE : 0);
      const same = !!now && !!was && now.clip === was.clip && now.start === was.start;
      // The channel each screen of the type finds its own item in, and its epoch as a tick, held while the epoch is the same.
      const at = now && !once ? view.doc.channels.findIndex((c) => c.name === screen.show) : -1, channel = at >= 0 ? view.doc.channels[at]! : null;
      const epoch = channel ? (this.epochs[i] === channel.epoch && s.channel === at ? s.epoch : startTick(this.world.tick, wall, channel.epoch)) : 0;
      this.epochs[i] = channel ? channel.epoch : NaN;
      const next: ScreenState = now
        ? { manifest: view.manifestId, show: SHOW_VIDEO, flags, clip: index.get(now.clip) ?? NO_CLIP, start: same ? s.start : startTick(this.world.tick, wall, now.start), next: now.next === null ? NO_CLIP : (index.get(now.next) ?? NO_CLIP), scene: heldSceneOf(screen.show), channel: at >= 0 ? at : NO_CHANNEL, epoch }
        : { manifest: view.manifestId, show: SHOW_SCENES, flags, clip: NO_CLIP, start: 0, next: NO_CLIP, scene: heldSceneOf(screen.show), channel: NO_CHANNEL, epoch: 0 };
      if (next.manifest !== s.manifest || next.show !== s.show || next.flags !== s.flags || next.clip !== s.clip || next.start !== s.start || next.next !== s.next || next.scene !== s.scene || next.channel !== s.channel || next.epoch !== s.epoch) {
        Object.assign(s, next);
        changed = true;
      }
      this.playing[i] = now;
    });
    if (changed) this.version++;
  }
}
