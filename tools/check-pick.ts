// Which tests a run of the check takes when it is not the whole fast tier: the folders and files it was given, or the
// smoke set (tests/smoke.txt). Either is a look while building, not the gate.

/** The smoke set's paths: one to a line, a `#` starting a comment, blank lines left out. */
export function smokeList(text: string): string[] {
  return text.split("\n").map((line) => line.replace(/#.*/, "").trim()).filter((line) => line !== "");
}

/**
 * The test files of `all` that `asked` names, in the order of `all`, and the names that match none. A file is taken as
 * named; a folder gives its fast tests, so a slow one runs only when named itself. Paths are from the repository's root.
 */
export function pick(asked: readonly string[], all: readonly string[], slow: RegExp): { files: string[]; none: string[] } {
  const taken = new Set<string>();
  const none: string[] = [];
  for (const raw of asked) {
    const path = raw.replace(/^\.\//, "").replace(/\/+$/, "");
    const found = all.includes(path) ? [path] : all.filter((f) => f.startsWith(path + "/") && !slow.test(f));
    if (found.length === 0) none.push(raw);
    for (const f of found) taken.add(f);
  }
  return { files: all.filter((f) => taken.has(f)), none };
}
