// What a world's Decider page asks of its server (server/admin/decide.ts) and how DecidePolicy is read and written, by
// the page and by the server alike.

import type { LabStatus, Scoreboard } from "./decide/scoreboard.ts";

export const POLICY_NAMES = ["off", "watch", "rule", "model"] as const;
/** The point that stands for every point not named. */
export const STAR = "*";
/** The Decide settings, the only ones the page and a cluster's copy may set. */
export const DECIDE_SETTINGS = ["DecidePolicy", "DecideSample", "DecideLogMegabytes"] as const;
export type DecideSettingName = (typeof DECIDE_SETTINGS)[number];

/** Each point's counts as the decider keeps them (server/decide/decide.ts Counts). */
export const COUNT_NAMES = ["put", "answered", "applied", "cut", "backPut", "backCut", "stale", "none", "fell", "logged", "closed"] as const;
export type CountName = (typeof COUNT_NAMES)[number];

/** One answer as the decider keeps it for a page that looks (server/decide/decide.ts Answered). */
export interface AnsweredJson {
  id: number;
  t: number;
  point: string;
  rung: number;
  policy: string;
  pick: number;
  other?: number;
  x?: number;
  z?: number;
  tables: { profile: string; k: number; state: number[]; rows: number[]; score: number[]; bias: number[]; mask: number[]; out: number[] }[];
}

export interface ProfileJson {
  name: string;
  kind: "choice" | "yes";
  ring: boolean;
  state: string[];
  columns: string[];
  /** The hand rule's weights that are not 0, each by what it reads, and its constant. */
  rule: { weights: [string, number][]; constant: number } | null;
  /** The trained scorer loaded for it, and its file's `about` where that file is still there. */
  trained: { hidden: number; temperature: number; about: Record<string, unknown> | null } | null;
}

/** GET <world>/admin/decide.json, with ?look=1 to keep answers while the page watches. */
export interface DecideJson {
  tick: number;
  rate: number;
  /** The world's size in metres, for the map of answers. */
  size: { x: number; z: number };
  points: { name: string; policy: string; counts: Record<CountName, number> }[];
  caps: number[];
  overflow: number;
  most: number;
  backMost: number;
  refused: string[];
  log: { written: number; bytes: number; dropped: number } | null;
  settings: { DecidePolicy: string; DecideSample: number; DecideLogMegabytes: number };
  profiles: ProfileJson[];
  /** The decide part of the tick: ms over every tick, the ticks, and the worst one tick took. */
  part: { all: number; ticks: number; worst: number };
  recent: AnsweredJson[];
  /** The lab's files in this checkout (.cache/decide), null where there are none. */
  lab: { scoreboard: Scoreboard | null; status: LabStatus | null };
  /** This world's id in its cluster, 0 for a world alone; and the cluster's copy it last took, 0 for none. */
  world: number;
  copied: number;
}

/** What POST <world>/admin/decide takes. Each answers { ok, why }. */
export type DecideOp =
  | { op: "policy"; point: string; policy: string }
  | { op: "set"; name: string; value: string }
  | { op: "reload" }
  | { op: "clone" };

/**
 * DecidePolicy as a table: each point named, in order, to its policy, `*` among them. Read as the decider reads it: pairs
 * split by commas or spaces, a policy it does not know left out, a later pair over an earlier.
 */
export function readPolicy(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const pair of text.split(/[,\s]+/)) {
    const [name, value] = pair.split("=");
    const policy = (value ?? "").toLowerCase();
    if (!name || !(POLICY_NAMES as readonly string[]).includes(policy)) continue;
    out.delete(name);
    out.set(name, policy);
  }
  return out;
}

/** The table as DecidePolicy's text: the named points in order, `*` last. */
export function policyText(table: ReadonlyMap<string, string>): string {
  const named = [...table].filter(([name]) => name !== STAR).map(([name, p]) => `${name}=${p}`);
  const star = table.get(STAR);
  return [...named, ...(star ? [`${STAR}=${star}`] : [])].join(",");
}

/** DecidePolicy with `point` set to `policy`; "" takes the point's own policy away so `*` decides it. */
export function withPolicy(text: string, point: string, policy: string): string {
  const table = readPolicy(text);
  table.delete(point);
  if (policy !== "") table.set(point, policy);
  return policyText(table);
}
