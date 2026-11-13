// What comes down the voice socket, made ready for the decoders.
//
// A decoder must be given a speaker's frames in the order they were made, each
// once. Over the socket they come that way; over a transport that drops and
// reorders they would not, so the order is checked here and never assumed.

import { BitReader } from "../../../shared/net/codec.ts";
import { MAX_INTRO_NAME, SAMPLE_RATE, VOICE_BATCH, VOICE_INTRO, readBatch, readIntro, seqNewer } from "../../../shared/voice/packet.ts";

/** A frame older than the last by less than this is a straggler; by more, its speaker has begun again. */
const RESTART = SAMPLE_RATE * 2;

export interface Speaker {
  /** The entity its voice is placed at, as a handle; 0 if it has not been said. */
  handle: number;
  name: string;
  lastSeq: number;
  lastTime: number;
}

export class Downlink {
  /** Frames handed on, frames that came out of order or twice, and packets that could not be read. */
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

  /**
   * A packet arrived. `frame` is called for each frame to decode, in order for
   * each speaker, with a view of its Opus that is good only during the call.
   */
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
      // A length and then UTF-8: a string as every other message has them.
      this.reader.reset(data.subarray(7));
      const name = this.reader.string(MAX_INTRO_NAME);
      if (s) {
        s.handle = intro.handle;
        s.name = name;
      } else this.speakers.set(intro.speaker, { handle: intro.handle, name, lastSeq: -1, lastTime: 0 });
    } else this.stats.malformed++;
  }
}
