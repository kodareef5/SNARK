// How the admin page writes its numbers: sizes, spans of time, times ago and milliseconds, short enough for a tile.

/** Bytes as KB, MB or GB, a thousand to the next. */
export function bytesText(n: number): string {
  if (n < 1000) return `${Math.round(n)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1000;
  let u = 0;
  while (v >= 1000 && u < units.length - 1) {
    v /= 1000;
    u++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[u]}`;
}

/** A span of milliseconds in its two largest units: "45 s", "12 min", "3 h 12 min", "4 d 6 h". */
export function spanText(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 === 0 ? `${h} h` : `${h} h ${m % 60} min`;
  const d = Math.floor(h / 24);
  return h % 24 === 0 ? `${d} d` : `${d} d ${h % 24} h`;
}

/** How long ago wall time `then` was at `now`: "just now" within ten seconds. */
export function agoText(then: number, now: number): string {
  const ms = now - then;
  return ms < 10_000 ? "just now" : `${spanText(ms)} ago`;
}

/** Milliseconds as a tick is read: two figures below ten, one place below a hundred, whole above. */
export function msText(ms: number): string {
  if (ms < 10) return `${ms.toFixed(ms < 1 ? 2 : 1)} ms`;
  return `${ms < 100 ? ms.toFixed(1) : Math.round(ms)} ms`;
}

/** A content id without its namespace, as words: "core:wild_boar" is "wild boar". */
export function idWords(id: string): string {
  return id.slice(id.indexOf(":") + 1).replace(/_/g, " ");
}

/** A count with its noun, plural past one: "1 survivor", "3 survivors". */
export function counted(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString("en")} ${n === 1 ? one : many}`;
}
