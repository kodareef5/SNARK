// The console's grammar, shared by the server (which executes lines) and the
// client (which edits and completes them).
//
// A line is words separated by spaces. Double quotes group a word that
// contains spaces. There is no escaping and no nesting.

export function tokenize(line: string): string[] {
  const out: string[] = [];
  let word = "";
  let quoted = false;
  let has = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      quoted = !quoted;
      has = true;
    } else if (!quoted && (ch === " " || ch === "\t")) {
      if (has) out.push(word);
      word = "";
      has = false;
    } else {
      word += ch;
      has = true;
    }
  }
  if (has) out.push(word);
  return out;
}

/** A finite number, or NaN. Accepts what a player would type: "12", "-3.5". */
export function parseNumber(word: string | undefined): number {
  if (word === undefined || !/^-?\d+(\.\d+)?$/.test(word)) return NaN;
  return Number(word);
}
