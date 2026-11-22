// Codes numbered by the order they are declared in. A new code is one new line, so two branches that each add one
// never take the same number: git asks to keep both lines, and the later line gets the next number.

/** Gives `first`, then the next whole number, each time it is called. */
export function counter(first = 1): () => number {
  let next = first;
  return () => next++;
}

export interface Flags {
  /** Bit 0, then bit 1, and so on: 1, 2, 4. */
  (): number;
  /** How many bits it has given. */
  count(): number;
}

export function flags(): Flags {
  let given = 0;
  return Object.assign((): number => 1 << given++, { count: (): number => given });
}
