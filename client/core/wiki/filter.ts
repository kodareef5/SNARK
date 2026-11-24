// The wiki's search and map view, decided here so that they are tested without a page.

/** A row of the search index: label, path, group, and the picture of its card or "". */
export type SearchRow = readonly [label: string, path: string, group: string, picture: string, id?: string, keywords?: string];

const fold = (text: string): string => text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();

export function searchTerms(query: string): string[] {
  return fold(query).trim().split(/\s+/).filter(Boolean);
}

/** Exact names and game IDs lead results with every search term. */
export function findRows(rows: readonly SearchRow[], query: string): SearchRow[] {
  const terms = searchTerms(query);
  if (terms.length === 0) return [];
  const exact = terms.join(" ");
  const matches = rows.flatMap((row) => {
    const [label, , group, , id = "", keywords = ""] = row;
    const name = fold(label);
    const key = fold(id);
    const text = `${name} ${key} ${fold(group)} ${fold(keywords)}`;
    if (!terms.every((term) => text.includes(term))) return [];
    const rank = name === exact || key === exact ? 0 : name.startsWith(exact) ? 1 : name.startsWith(terms[0]!) ? 2 : 3;
    return [{ row, rank }];
  });
  return matches.sort((a, b) => a.rank - b.rank || a.row[0].localeCompare(b.row[0])).map(({ row }) => row);
}

/** A zoom from 1 to 8 and a pan that keeps the map over the view. */
export function mapTransform(zoom: number, x: number, y: number, width: number, height: number): { zoom: number; x: number; y: number } {
  const z = Math.max(1, Math.min(8, Number.isFinite(zoom) ? zoom : 1));
  const clamp = (n: number, limit: number): number => Math.max(-limit, Math.min(limit, Number.isFinite(n) ? n : 0));
  return { zoom: z, x: clamp(x, (width * (z - 1)) / 2), y: clamp(y, (height * (z - 1)) / 2) };
}
