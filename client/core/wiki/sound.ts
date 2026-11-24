// The wiki plays one take from the game's sound pack at a time.

interface SoundRow {
  file?: string;
  at?: string;
  takes?: string;
}

/** The selected take's inclusive byte range and decoded sample count. */
export function takeRange(row: SoundRow, index: number): { from: number; to: number; samples: number } {
  const takes = row.takes?.split(" ") ?? [];
  const picked = takes[index];
  if (!picked) throw new Error("The sound has no such take.");
  const [samples = 0, bytes = 0] = picked.split(":").map(Number);
  const from = takes.slice(0, index).reduce((offset, take) => offset + Number(take.split(":")[1]), Number(row.at));
  const to = from + bytes - 1;
  if (![from, to, samples].every(Number.isSafeInteger) || from < 0 || to < from || samples < 1) throw new Error("The take has an invalid range.");
  return { from, to, samples };
}

interface SoundReply {
  status: number;
  arrayBuffer(): Promise<ArrayBuffer>;
  body?: { cancel(): Promise<void> } | null;
}

type Get = (url: string, init: { headers: Record<string, string> }) => Promise<SoundReply>;

export async function takeSamples(row: SoundRow, index: number, get: Get): Promise<Float32Array<ArrayBuffer>> {
  if (!row.file) throw new Error("The sound file is missing.");
  const { from, to, samples } = takeRange(row, index);
  const answer = await get(row.file, { headers: { range: `bytes=${from}-${to}` } });
  if (answer.status !== 206) {
    void answer.body?.cancel().catch(() => {});
    throw new Error(`The server sent ${answer.status} for a range of ${row.file}.`);
  }
  const data = new Uint8Array(await answer.arrayBuffer());
  if (data.length !== to - from + 1) throw new Error(`The take at ${from} has the wrong length.`);
  const { decodeTake } = await import("../../../shared/pack/sound.ts");
  const decoded = new Float32Array(samples);
  if (!decodeTake(data, samples, decoded)) throw new Error(`The take at ${from} could not be decoded.`);
  return decoded;
}
