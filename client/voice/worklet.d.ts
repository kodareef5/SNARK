// Globals of the audio worklet scope, which the DOM library does not declare.

declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
}
declare function registerProcessor(name: string, processor: new () => AudioWorkletProcessor): void;
/** Samples a second of the audio context the worklet runs in. */
declare const sampleRate: number;
