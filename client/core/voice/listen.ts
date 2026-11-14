// Readies voice packets for the decoders. A decoder needs each speaker's frames in order and once each,
// so the order is checked here and never assumed.

import { BitReader } from "../../../shared/net/codec.ts";
import { MAX_INTRO_NAME, SAMPLE_RATE, VOICE_BATCH, VOICE_INTRO, readBatch, readIntro, seqNewer } from "../../../shared/voice/packet.ts";

/** A frame older than the last by less than this is a straggler. By more, its speaker has begun again. In samples. */
const RESTART = SAMPLE_RATE * 2;

export interface Speaker {
  /** Handle of the entity the voice is placed at, or 0 until an intro gives it. */
  handle: number;
  name: string;
  lastSeq: number;
  lastTime: number;
}

export class Downlink {
  /** stale counts frames that came out of order or twice. */
  readonly stats = { frames: 0, stale: 0, malformed: 0 };
  readonly speakers = new Map<number, Speaker>();
  private readonly reader = new BitReader();
  private frame: ((speaker: number, flags: number, time: number, opus: Uint8Array) => void) | null = null;
  private readonly each = (speaker: number, flags: number, seq: number, time: number, opus: Uint8Array): void => {
    let s = this.speakers.get(speaker);
    if (!s) this.speakers.set(speaker, (s = { handle: 0, name: "", lastSeq: -1, lastTime: 0 }));
    else if (s.lastSeq >= 0 && !seqNewer(seq, s.lastSeq) && time <= s.lastTime && s.lastTime - time < RESTART) {
      this.stats.stale++;
      return;
    }
    s.lastSeq = seq;
    s.lastTime = time;
    this.stats.frames++;
    this.frame!(speaker, flags, time, opus);
  };

  /** Calls `frame` for each frame to decode, in order for each speaker. The Opus view is good only during the call. */
  receive(data: Uint8Array, frame: (speaker: number, flags: number, time: number, opus: Uint8Array) => void): void {
    if (data[0] === VOICE_BATCH) {
      this.frame = frame;
      if (!readBatch(data, this.each)) this.stats.malformed++;
      this.frame = null;
    } else if (data[0] === VOICE_INTRO) {
      const intro = readIntro(data);
      if (!intro) {
        this.stats.malformed++;
        return;
      }
      const s = this.speakers.get(intro.speaker);
      // The name is a length and then UTF-8, like a string in any other message.
      this.reader.reset(data.subarray(7));
      const name = this.reader.string(MAX_INTRO_NAME);
      if (s) {
        s.handle = intro.handle;
        s.name = name;
      } else this.speakers.set(intro.speaker, { handle: intro.handle, name, lastSeq: -1, lastTime: 0 });
    } else this.stats.malformed++;
  }
}
