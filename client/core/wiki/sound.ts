// A sound's takes as the wiki's page plays them: where they lie in the game's sound file, from what the sound's row says,
// asked for by range alone at the first press, and decoded as the game decodes them.

/** The bytes from `from` to `to`, both in, and each take's samples and bytes in order. */
export function takeRange(row: { at?: string; takes?: string }): { from: number; to: number; sizes: { samples: number; bytes: number }[] } {
  const sizes = (row.takes ?? "").split(" ").map((t) => {
    const [samples, bytes] = t.split(":").map(Number);
    return { samples: samples!, bytes: bytes! };
  });
  const from = Number(row.at);
  return { from, to: from + sizes.reduce((n, t) => n + t.bytes, 0) - 1, sizes };
}

/** What the page's fetch is asked and answers, as far as a range of a file goes. */
export type Get = (url: string, init: { headers: Record<string, string> }) => Promise<{ status: number; arrayBuffer(): Promise<ArrayBuffer> }>;

/** Each take of a sound's row, as samples. */
export async function takeSamples(row: { file?: string; at?: string; takes?: string }, get: Get): Promise<Float32Array<ArrayBuffer>[]> {
  const { from, to, sizes } = takeRange(row);
  const answer = await get(row.file!, { headers: { range: `bytes=${from}-${to}` } });
  if (answer.status !== 206) throw new Error(`the server sent ${answer.status} for a range of ${row.file}`);
  const { decodeTakes } = await import("../../../shared/pack/sound.ts");
  const samples = decodeTakes(new Uint8Array(await answer.arrayBuffer()), sizes);
  if (!samples) throw new Error(`${row.file} at ${from} does not decode`);
  return samples;
}
