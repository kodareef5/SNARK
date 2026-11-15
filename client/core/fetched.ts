// What the page fetches whole as it starts. A request that fails says which it was and what the server answered, not
// a parser's complaint about the answer.

export interface Answer {
  ok: boolean;
  status: number;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export type Get = (url: string) => Promise<Answer>;

/** An answer the server gave with a success status, or an error naming the request and how it failed. */
async function answer(get: Get, url: string): Promise<Answer> {
  let res: Answer;
  try {
    res = await get(url);
  } catch (e) {
    throw new Error(`${url}: no answer (${e instanceof Error ? e.message : String(e)})`);
  }
  if (!res.ok) throw new Error(`${url}: the server answered ${res.status}: ${JSON.stringify((await res.text().catch(() => "")).slice(0, 60))}`);
  return res;
}

export async function fetchText(get: Get, url: string): Promise<string> {
  return (await answer(get, url)).text();
}

export async function fetchBytes(get: Get, url: string): Promise<ArrayBuffer> {
  return (await answer(get, url)).arrayBuffer();
}

export async function fetchJson(get: Get, url: string): Promise<unknown> {
  const res = await answer(get, url);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${url}: the server answered ${res.status} with what is not JSON: ${JSON.stringify(text.slice(0, 60))}`);
  }
}
