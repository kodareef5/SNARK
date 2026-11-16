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

/** Sort a[from..to) ascending (quicksort, median of three, insertion sort under 16; recursion on the smaller side). */
export function sortF64(a: Float64Array, from: number, to: number): void {
  while (to - from > 16) {
    const x = a[from]!, y = a[(from + to) >> 1]!, z = a[to - 1]!;
    const pivot = x < y ? (y < z ? y : x < z ? z : x) : x < z ? x : y < z ? z : y;
    let i = from, j = to - 1;
    while (i <= j) {
      while (a[i]! < pivot) i++;
      while (a[j]! > pivot) j--;
      if (i > j) break;
      const t = a[i]!;
      a[i++] = a[j]!;
      a[j--] = t;
    }
    if (j + 1 - from < to - i) {
      sortF64(a, from, j + 1);
      from = i;
    } else {
      sortF64(a, i, to);
      to = j + 1;
    }
  }
  for (let i = from + 1; i < to; i++) {
    const v = a[i]!;
    let j = i - 1;
    for (; j >= from && a[j]! > v; j--) a[j + 1] = a[j]!;
    a[j + 1] = v;
  }
}
