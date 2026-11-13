// What the app asks of whatever carries voice.
//
// In a browser that is client/voice: a microphone, an encoder, a socket, and
// the way to the ear. Under test there is none, and the app runs the same.

export interface VoiceSpeaker {
  /** The entity its voice comes from, as a handle. */
  handle: number;
  name: string;
  /** It is being heard now. */
  speaking: boolean;
}

/** Numbers to a speaker in what `hear` is given: its number, how far off it is, and which side it is on. */
export const HEAR_FIELDS = 3;

export interface VoicePort {
  /** A few words for the screen when there is something to say ("microphone refused"), else "". */
  readonly notice: string;
  /** How loud the microphone is now, 0 to 1; and whether what it hears is being sent. */
  readonly level: number;
  readonly sending: boolean;
  /**
   * The talk key: `on` while the microphone is wanted, as loud as `mode`
   * (whisper, talk, yell). With `open` it is left on, and only what it hears
   * is sent; without, everything is, for as long as `on` is so.
   */
  talk(on: boolean, mode: number, open: boolean): void;
  /** How loud everyone is played: 1 is as they are. */
  volume(gain: number): void;
  /** Everyone this client has been sent the voice of, by speaker number. */
  readonly speakers: ReadonlyMap<number, VoiceSpeaker>;
  /**
   * Where each speaker is from here: `count` runs of a speaker number, how far
   * off in metres (-1 for one whose body this client cannot see), and which
   * side (-1 left to 1 right).
   */
  hear(places: Float32Array, count: number): void;
}
