// The app's interface to voice. client/voice implements it in a browser. Tests run without one.

export interface VoiceSpeaker {
  /** Handle of the entity the voice comes from. */
  handle: number;
  name: string;
  speaking: boolean;
}

/** Numbers per speaker in hear()'s `places`. */
export const HEAR_FIELDS = 3;

export interface VoicePort {
  /** Words for the screen such as "microphone refused", else "". */
  readonly notice: string;
  /** Microphone level, 0 to 1. */
  readonly level: number;
  readonly sending: boolean;
  /** `mode` is a MODE_ value. With `open` the microphone stays on and sends only what it hears. Without, it sends everything while `on`. */
  talk(on: boolean, mode: number, open: boolean): void;
  /** 1 plays voices unchanged. */
  volume(gain: number): void;
  /** Keyed by speaker number. */
  readonly speakers: ReadonlyMap<number, VoiceSpeaker>;
  /** `places` holds `count` runs of speaker number, distance in metres (-1 for an unseen body), and pan from -1 left to 1 right. */
  hear(places: Float32Array, count: number): void;
}
