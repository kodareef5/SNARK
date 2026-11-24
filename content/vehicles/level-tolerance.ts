/** Multipliers on the tier's pixel allowance for each body level, finest first. */
export const BODY_LEVEL_TOLERANCE: Readonly<Record<string, readonly number[]>> = {
  // Keep a textured street-distance level between the close body and its flat silhouette.
  "core:concept003": [1, 16, 3, 3, 3.75, 3],
};

export function bodyLevelError(tolerance: readonly number[] | undefined, level: number, metres: number): number {
  return metres / (tolerance?.[level] ?? 1);
}
