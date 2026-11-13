// What the app asks of whatever carries voice.
//
// In a browser that is client/voice: a microphone, an encoder, a socket, and
// the way to the ear. Under test there is none, and the app runs the same.

export interface VoicePort {
  /** A few words for the screen when there is something to say ("microphone refused"), else "". */
  readonly notice: string;
  /** The talk key went down or came up. */
  talk(on: boolean): void;
}
