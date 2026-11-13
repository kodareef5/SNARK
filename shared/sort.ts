// In-place sorts for typed-array ranges. No allocation, unlike subarray().sort().

const GAPS = [701, 301, 132, 57, 23, 10, 4, 1];

/** Sort a[0..n) ascending (Shell sort, Ciura gaps). */
export function sortU32(a: Uint32Array, n: number): void {
  for (let g = 0; g < GAPS.length; g++) {
    const gap = GAPS[g]!;
    if (gap >= n) continue;
    for (let i = gap; i < n; i++) {
      const v = a[i]!;
      let j = i;
      while (j >= gap && a[j - gap]! > v) {
        a[j] = a[j - gap]!;
        j -= gap;
      }
      a[j] = v;
    }
  }
}
