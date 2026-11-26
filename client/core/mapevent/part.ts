// The map events in the frame (planning/workstreams/map-events.md). Their code is asked for once the session is told of
// one; each new feed is read once; what was read goes to the scene's pass with the tick to draw it at, which is the tick
// the remote bodies are shown at (session.shown) and so the tick the server judges a shot at: a round aimed at what is
// seen meets it. The sounds are given what hears it once there are sounds.

import { askMapEvents, feedTold, takeFeed } from "../mapevent-load.ts";
import type { AppFrame, FramePart } from "../frame.ts";
import { Scene } from "../render/scene.ts";
import type { Sounds } from "../sound/sounds.ts";
import type { MapEventsShown } from "./shown.ts";

export class MapEventPart implements FramePart {
  /** Whether this client has asked for the code, which it does once it is told of an event. */
  asked = false;
  /** The events as last read, or null before any. */
  shown: MapEventsShown | null = null;
  private heard: Sounds | null = null;
  private readonly sounds: () => Sounds | null;
  private readonly failed = (): void => {
    this.asked = false;
  };

  /** `sounds` gives the app's sounds, or null while it has none. */
  constructor(sounds: () => Sounds | null) {
    this.sounds = sounds;
  }

  step(f: AppFrame): void {
    const s = f.session;
    if (!this.asked) {
      if (!feedTold(s)) return;
      this.asked = true;
      askMapEvents().catch(this.failed);
    }
    const code = Scene.mapEvents;
    if (!code) return;
    const bytes = takeFeed(s);
    if (bytes !== undefined) this.shown = code.read(bytes, this.shown);
    const shown = this.shown;
    if (!shown) return;
    shown.tick = s.shown;
    f.scene.mapEventsShown = shown;
    const sounds = this.sounds();
    if (sounds !== null && sounds !== this.heard) {
      this.heard = sounds;
      sounds.producers.push(code.hearing(this));
    }
  }
}
