// What a world tells its clients the screens play (OWN_SCREEN). Once a second, off the tick, it works out each screen's
// programme on the wall clock and turns it into world ticks; a client is sent the message only when that changes.
import { TICK_RATE } from "../../shared/coords.ts";
import { OWN_SCREEN } from "../../shared/net/protocol.ts";
import { isDay } from "../../shared/sim/clock.ts";
import { SCREENS, defaultScreen } from "../../shared/video/clip.ts";
import { screenAt, type Playing } from "../../shared/video/programme.ts";
import { NO_CLIP, SCREEN_FILL, SCREEN_SOUND, SCREEN_FACING, SHOW_SCENES, SHOW_VIDEO, writeScreens, type ScreenState } from "../../shared/video/screen.ts";
import type { GameServer } from "../game.ts";
import { worldHour, type ServerWorld } from "../world.ts";
import type { LibraryView } from "./library.ts";

/** How often the library's file is looked at for a change, in milliseconds. */
export const LIBRARY_CHECK_MS = 2000;
const SWEEP_MS = 60_000;

/** What the feed reads the library by: a stamp that changes when it may have, and the library itself. */
export interface LibrarySource {
  stamp(): string;
  view(): LibraryView;
  sweep(): void;
}

/** It is night where the sun is down: outside the hours of day on the world's clock. */
export const worldNight = (world: ServerWorld): boolean => !isDay(worldHour(world));

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
  /** What each screen played at the last poll, so its start tick holds while the same item plays. */
  private readonly playing: (Playing | null)[] = [];

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
      const s = this.states[i] ?? (this.states[i] = { manifest: "", show: SHOW_SCENES, flags: 0, clip: NO_CLIP, start: 0, next: NO_CLIP });
      const flags = (screen.mode === "facing" ? SCREEN_FACING : 0) | (screen.fill ? SCREEN_FILL : 0) | (screen.sound ? SCREEN_SOUND : 0);
      const same = !!now && !!was && now.clip === was.clip && now.start === was.start;
      const next: ScreenState = now
        ? { manifest: view.manifestId, show: SHOW_VIDEO, flags, clip: index.get(now.clip) ?? NO_CLIP, start: same ? s.start : startTick(this.world.tick, wall, now.start), next: now.next === null ? NO_CLIP : (index.get(now.next) ?? NO_CLIP) }
        : { manifest: view.manifestId, show: SHOW_SCENES, flags, clip: NO_CLIP, start: 0, next: NO_CLIP };
      if (next.manifest !== s.manifest || next.show !== s.show || next.flags !== s.flags || next.clip !== s.clip || next.start !== s.start || next.next !== s.next) {
        Object.assign(s, next);
        changed = true;
      }
      this.playing[i] = now;
    });
    if (changed) this.version++;
  }
}
