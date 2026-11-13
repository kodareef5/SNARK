// What an audio worklet's own scope gives a processor, which the DOM library does not describe.

declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
}
declare function registerProcessor(name: string, processor: new () => AudioWorkletProcessor): void;
/** Samples a second of the audio context the worklet runs in. */
declare const sampleRate: number;
