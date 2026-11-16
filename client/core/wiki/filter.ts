// The wiki's search and map view, decided here so that they are tested without a page.

/** A row of the search index: label, path, group, and the picture of its card or "". */
export type SearchRow = readonly [label: string, path: string, group: string, picture: string];

const fold = (text: string): string => text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();

export function searchTerms(query: string): string[] {
  return fold(query).trim().split(/\s+/).filter(Boolean);
}

/** The rows every term is in, those whose label begins with the first term first, at most `most`. */
export function findRows(rows: readonly SearchRow[], query: string, most: number): SearchRow[] {
  const terms = searchTerms(query);
  if (terms.length === 0) return [];
  const hits = rows.filter((r) => {
    const text = fold(`${r[0]} ${r[2]}`);
    return terms.every((t) => text.includes(t));
  });
  const starts = (r: SearchRow): number => (fold(r[0]).startsWith(terms[0]!) ? 0 : 1);
  return hits.sort((a, b) => starts(a) - starts(b) || a[0].localeCompare(b[0])).slice(0, most);
}

/** A zoom from 1 to 8 and a pan that keeps the map over the view. */
export function mapTransform(zoom: number, x: number, y: number, width: number, height: number): { zoom: number; x: number; y: number } {
  const z = Math.max(1, Math.min(8, Number.isFinite(zoom) ? zoom : 1));
  const clamp = (n: number, limit: number): number => Math.max(-limit, Math.min(limit, Number.isFinite(n) ? n : 0));
  return { zoom: z, x: clamp(x, (width * (z - 1)) / 2), y: clamp(y, (height * (z - 1)) / 2) };
}
