// S_CHAT: a chat line as runs of text, each in its own ink or its channel's. The server writes it and the client reads it here.

import { fitBytes, utf8Length, type BitReader, type BitWriter } from "./codec.ts";
import { MAX_SERVER_TEXT_BYTES } from "./protocol.ts";

/** A piece of a line in one ink: 0xRRGGBB, or absent for the channel's own colour. */
export interface TextRun {
  text: string;
  ink?: number;
}

/** A chat line as the client keeps it: its runs, and their text joined. */
export interface ChatLine {
  channel: number;
  text: string;
  runs: TextRun[];
}

/** Runs one line may have. */
export const CHAT_RUNS_MOST = 8;

/** The runs' text, joined. */
export function runText(runs: readonly TextRun[]): string {
  let text = "";
  for (const r of runs) text += r.text;
  return text;
}

/** After the message's kind. Runs past the most are left out, and text past MAX_SERVER_TEXT_BYTES is cut. */
export function writeChat(w: BitWriter, channel: number, runs: readonly TextRun[]): void {
  w.u8(channel);
  const n = Math.max(1, Math.min(runs.length, CHAT_RUNS_MOST));
  w.bits(n, 4);
  let left = MAX_SERVER_TEXT_BYTES;
  for (let i = 0; i < n; i++) {
    const run = runs[i] ?? { text: "" };
    w.bool(run.ink !== undefined);
    if (run.ink !== undefined) w.bits(run.ink & 0xffffff, 24);
    const text = fitBytes(run.text, left);
    left -= utf8Length(text);
    w.string(text);
  }
}

/** After the message's kind. Null where the message is broken, has no run or more than the most, or its text is over MAX_SERVER_TEXT_BYTES. */
export function readChat(r: BitReader): ChatLine | null {
  const channel = r.u8();
  const n = r.bits(4);
  if (n === 0 || n > CHAT_RUNS_MOST) return null;
  const runs: TextRun[] = [];
  let left = MAX_SERVER_TEXT_BYTES;
  for (let i = 0; i < n && !r.overflow; i++) {
    const ink = r.bool() ? r.bits(24) : -1;
    const text = r.string(left);
    left -= utf8Length(text);
    runs.push(ink < 0 ? { text } : { text, ink });
  }
  return r.overflow ? null : { channel, text: runText(runs), runs };
}
