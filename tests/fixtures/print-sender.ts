// A browser's side of a print's upload, on a thread of its own so that sending costs the server's thread nothing: told
// {url, bytes, length?}, it posts the bytes and answers the status.
declare const self: { onmessage: ((e: { data: { url: string; bytes: Uint8Array; length?: number } }) => void) | null; postMessage(m: number): void };

self.onmessage = async (e) => {
  const { url, bytes, length } = e.data;
  const headers: Record<string, string> = { "content-type": "image/png", ...(length !== undefined ? { "content-length": String(length) } : {}) };
  try {
    const res = await fetch(url, { method: "POST", body: bytes, headers });
    await res.arrayBuffer();
    self.postMessage(res.status);
  } catch {
    self.postMessage(-1);
  }
};
