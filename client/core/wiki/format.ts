// Numbers and times as the wiki writes them, the same in the build and on the page.

/** A number as a player reads it: grouped, and to `digits` places with trailing zeros dropped. */
export function num(n: number, digits = 2): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: digits });
}

/** Seconds as days, hours, minutes and seconds, the two largest that are not zero. */
export function time(seconds: number): string {
  const s = Math.round(seconds);
  const parts = [[Math.floor(s / 86400), "d"], [Math.floor(s / 3600) % 24, "h"], [Math.floor(s / 60) % 60, "min"], [s % 60, "s"]] as const;
  const first = parts.findIndex(([n]) => n > 0);
  if (first < 0) return "0 s";
  return parts.slice(first, first + 2).filter(([n]) => n > 0).map(([n, u]) => `${n} ${u}`).join(" ");
}
