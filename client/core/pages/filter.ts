export function searchTerms(query: string): string[] {
  return query.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().trim().split(/\s+/).filter(Boolean);
}

export function matchesGuideQuery(text: string, terms: readonly string[]): boolean {
  const folded = text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
  return terms.every((term) => folded.includes(term));
}

export function mapTransform(zoom: number, x: number, y: number, width: number, height: number): { zoom: number; x: number; y: number } {
  const bounded = Math.max(1, Math.min(5, Number.isFinite(zoom) ? zoom : 1));
  const limitX = Math.max(0, width * (bounded - 1) / 2);
  const limitY = Math.max(0, height * (bounded - 1) / 2);
  const clamp = (n: number, limit: number): number => limit === 0 ? 0 : Math.max(-limit, Math.min(limit, Number.isFinite(n) ? n : 0));
  return { zoom: bounded, x: clamp(x, limitX), y: clamp(y, limitY) };
}
