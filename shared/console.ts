// The console's grammar, shared by the server and the client. A line is words separated by spaces.
// Double quotes group a word that contains spaces. There is no escaping and no nesting.

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

/** Commands whose arguments are a password. A line of one is shown masked and is not kept, by the client and the server alike. */
export const SECRET_COMMANDS: readonly string[] = ["enablecheats", "claimpassword"];
/** Settings whose value is a secret, in lower case: `setting <name> <value>` is masked for these (server/settings, `secret`). */
export const SECRET_SETTINGS: readonly string[] = ["serverpassword", "serveradminpassword", "clusteradminpassword", "spectatorpassword", "castmodelkey"];
/** Words before a line that run the rest of it as a command (server/commands/permissions.ts). */
const RUN_PREFIXES: readonly string[] = ["cheat", "admincheat"];

/**
 * The line with a secret command's arguments, or a secret setting's value, shown as ****, or null when it carries no
 * secret. It sees through a chat box's leading slash and through `cheat` and `admincheat`, in any case.
 */
export function maskSecret(line: string): string | null {
  const trimmed = line.trim();
  const slash = trimmed.startsWith("/");
  const words = tokenize(slash ? trimmed.slice(1) : trimmed);
  let at = 0;
  while (at < words.length - 1 && RUN_PREFIXES.includes(words[at]!.toLowerCase())) at++;
  if (at >= words.length - 1) return null;
  const name = words[at]!.toLowerCase();
  // `setting <name> <value>` carries a secret only for a secret row, and only once a value is given.
  const shown = name === "setting" ? (at < words.length - 2 && SECRET_SETTINGS.includes(words[at + 1]!.toLowerCase()) ? at + 2 : -1) : SECRET_COMMANDS.includes(name) ? at + 1 : -1;
  if (shown < 0) return null;
  return `${slash ? "/" : ""}${words.slice(0, shown).join(" ")} ****`;
}

/** Wrong `enablecheats` passwords one connection may give: the last of them ends it. */
export const CHEAT_GUESSES = 3;
/** What `enablecheats` answers a wrong password, word for word. The Creative screen counts these answers. */
export const WRONG_PASSWORD = "wrong password";

/** Returns NaN unless the word is a plain decimal such as "12" or "-3.5". */
export function parseNumber(word: string | undefined): number {
  if (word === undefined || !/^-?\d+(\.\d+)?$/.test(word)) return NaN;
  return Number(word);
}
