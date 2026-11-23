// How the debug bar writes its numbers: short, with their units, the same everywhere.

const KB = 1024, MB = 1024 * 1024, GB = 1024 * MB;

/** Milliseconds: two decimals under 1, one under 100, none above. */
export function ms(v: number): string {
  if (!Number.isFinite(v)) return "–";
  return v < 1 ? `${v.toFixed(2)} ms` : v < 100 ? `${v.toFixed(1)} ms` : `${Math.round(v)} ms`;
}

export function bytes(n: number): string {
  if (!Number.isFinite(n)) return "–";
  const a = Math.abs(n);
  return a < KB ? `${Math.round(n)} B` : a < MB ? `${(n / KB).toFixed(a < 10 * KB ? 1 : 0)} KB` : a < GB ? `${(n / MB).toFixed(a < 10 * MB ? 1 : 0)} MB` : `${(n / GB).toFixed(2)} GB`;
}

/** Bytes a second. */
export function rate(n: number): string {
  return `${bytes(n)}/s`;
}

/** A count with a thousands mark: 12,400. */
export function count(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

/** A share as a percentage, whole above 10 and to a tenth below. */
export function share(part: number, whole: number): string {
  if (!(whole > 0)) return "–";
  const p = (part / whole) * 100;
  return `${p >= 10 || p === 0 ? Math.round(p) : p.toFixed(1)}%`;
}

/** How long ago `ms` was: "now", "14 s ago", "2:05 ago". */
export function ago(ms: number): string {
  if (ms < 1000) return "now";
  const s = Math.floor(ms / 1000);
  return s < 60 ? `${s} s ago` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")} ago`;
}

/** A time of day from wall-clock ms, to the millisecond: 14:03:09.210. */
export function clock(wallMs: number): string {
  const d = new Date(wallMs), two = (n: number): string => String(n).padStart(2, "0");
  return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, "0")}`;
}
