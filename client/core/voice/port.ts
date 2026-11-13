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

export interface VoicePort {
  /** A few words for the screen when there is something to say ("microphone refused"), else "". */
  readonly notice: string;
  /** The talk key went down or came up. */
  talk(on: boolean): void;
  /** Everyone this client has been sent the voice of, by speaker number. */
  readonly speakers: ReadonlyMap<number, VoiceSpeaker>;
  /**
   * How far off each speaker is: `count` pairs of a speaker number and metres,
   * with -1 for one whose body this client cannot see.
   */
  hear(distances: Float32Array, count: number): void;
}
