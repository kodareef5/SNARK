// What a player seems to be up to, by rules alone, for the planner to weigh scenes by: a few coarse tags from what it
// carries, how it moves and words in what it says (building, gathering, armed, driving, exploring, social, lost,
// fighting, idle). What it typed reaches the planner only as one short snippet marked untrusted, cleaned of anything
// that could pass for an instruction's shape; it is data about the player, never words to the planner.

export interface PlayerView {
  name: string;
  /** Metres a second, on the ground or in a vehicle. */
  speed: number;
  driving: boolean;
  /** Classes of what it carries, with counts: "weapon", "armor", "structure", "resource", ... */
  carries: Record<string, number>;
  /** Its own recent lines, newest last. */
  said: string[];
}

export type IntentTag = "building" | "gathering" | "armed" | "driving" | "exploring" | "social" | "lost" | "fighting" | "trading" | "idle";

const WORDS: [RegExp, IntentTag][] = [
  [/\b(build|base|wall|foundation|roof|door)\b/i, "building"],
  [/\b(wood|stone|thatch|fiber|metal|farm|gather|harvest)\b/i, "gathering"],
  [/\b(help|anyone|lost|where|which way|stuck)\b/i, "lost"],
  [/\b(fight|kill|raid|attack|pvp|gun|shoot)\b/i, "fighting"],
  [/\b(trade|sell|buy|price|deal)\b/i, "trading"],
  [/\b(hi|hey|hello|lol|haha|friend|tribe|join)\b/i, "social"],
];

export function intentOf(p: PlayerView): { tags: IntentTag[]; said_untrusted?: string } {
  const tags = new Set<IntentTag>();
  if (p.driving) tags.add("driving");
  if ((p.carries.weapon ?? 0) > 0) tags.add("armed");
  if ((p.carries.structure ?? 0) >= 3) tags.add("building");
  if ((p.carries.resource ?? 0) >= 50) tags.add("gathering");
  if (p.speed > 4 && !p.driving) tags.add("exploring");
  for (const line of p.said.slice(-3)) for (const [re, tag] of WORDS) if (re.test(line)) tags.add(tag);
  if (!tags.size && p.speed < 0.3) tags.add("idle");
  const last = p.said.at(-1);
  const snippet = last ? untrusted(last) : "";
  return { tags: [...tags], ...(snippet ? { said_untrusted: snippet } : {}) };
}

/** A player's words cut to a short plain phrase: no brackets, quotes, braces or line breaks to dress it as something else. */
export function untrusted(text: string): string {
  return text.replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/[<>{}[\]()"'`*#\\|]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}
