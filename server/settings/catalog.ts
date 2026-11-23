// Every setting an ARK dedicated server reads, in one table. A planned row names the feature it waits for.

import { FEATURES, NOT_HERE, type Row } from "./row.ts";
import { MODE_ROWS } from "./rows-mode.ts";
import { SERVER_ROWS } from "./rows-server.ts";

export const CATALOG: readonly Row[] = [...SERVER_ROWS, ...MODE_ROWS];

/** ARK matches keys without regard to case. A command-line flag is distinct from a file key with the same letters. */
export const keyOf = (name: string, flag = false): string => (flag ? "-" : "") + name.toLowerCase();

const byKey = new Map<string, Row>();
for (const row of CATALOG) byKey.set(keyOf(row.name, row.kind === "flag"), row);

export function rowOf(name: string, flag = false): Row | undefined {
  return byKey.get(keyOf(name, flag));
}

/**
 * The settings that take effect and stay read at a start only, each with why, by name (a flag's with its dash). Every
 * other setting that takes effect may change while the server runs: a row added without `live` must be named here.
 */
export const AT_START: Readonly<Record<string, string>> = {
  Port: "It is the address survivors and the cluster hold for this server.",
  "-port": "It is the address survivors and the cluster hold for this server.",
  "-clusterid": "It fixes which cluster the world belongs to, and its number there.",
  "-ClusterDirOverride": "It is where the cluster keeps its travellers.",
  "-AllowNetworkSave": "It is asked once, as the save is opened.",
  "-ForceRespawnDinos": "It acts once, as the server starts.",
  ServerAutoForceRespawnWildDinosInterval: "It is looked at once, as the server starts.",
  "-WinLiveMaxPlayers": "It gives the seats at a start. MaxPlayers changes them while the server runs.",
  bUseSingleplayerSettings: "It multiplies other settings once, as the files are read.",
  ServerAdminPassword: "It is the lock this page stands behind.",
};

/** Why a setting may not change while the server runs, or "" if it may. */
export function fixedWhy(row: Row): string {
  if (row.status !== "live") return "does not take effect yet";
  return row.live ? "" : "is read when the server starts: set it in its file and start again";
}

/** Faults in the catalogue itself, one per line. The tests run it, so a row cannot be added half made. */
export function catalogFaults(): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const r of CATALOG) {
    const key = keyOf(r.name, r.kind === "flag");
    if (seen.has(key)) out.push(`${r.name}: listed twice`);
    seen.add(key);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(r.name)) out.push(`${r.name}: not a name`);
    if (r.doc.trim() === "" || !r.doc.endsWith(".")) out.push(`${r.name}: needs a meaning, as a sentence`);
    if (r.status === "planned" && !(r.waits in FEATURES)) out.push(`${r.name}: waits for "${r.waits}", which is no feature`);
    if (r.status === "none" && !(r.waits in NOT_HERE)) out.push(`${r.name}: "${r.waits}" is no reason`);
    if (r.status === "todo" && !/^phase \d+$/.test(r.waits)) out.push(`${r.name}: a row to be wired names its phase`);
    if (r.status === "live" && r.waits !== "") out.push(`${r.name}: a live row waits for nothing`);
    const effective = r.status === "live" || r.status === "todo";
    if (!effective && (r.live || r.client || r.retime !== "")) out.push(`${r.name}: only a row that takes effect can be live, told to clients, or re-timed`);
    if (r.kind === "float" || r.kind === "int") {
      const d = r.def as number;
      if (typeof d !== "number" || !(d >= r.min && d <= r.max)) out.push(`${r.name}: its default ${String(r.def)} is outside ${r.min} to ${r.max}`);
      if (r.kind === "int" && !Number.isInteger(d)) out.push(`${r.name}: a whole number has a whole default`);
    } else if (r.kind === "bool") {
      if (typeof r.def !== "boolean") out.push(`${r.name}: a switch defaults to on or off`);
    } else if (r.kind === "text") {
      if (typeof r.def !== "string") out.push(`${r.name}: words default to words`);
    } else if (r.kind === "indexed") {
      if (!Array.isArray(r.def) || r.def.length === 0 || r.def.some((v) => !(v >= r.min && v <= r.max))) out.push(`${r.name}: an indexed setting has a default in range for each index`);
    } else if (r.kind === "flag") {
      if (r.at !== "cli") out.push(`${r.name}: a flag belongs to the command line`);
    } else if (r.def !== null) out.push(`${r.name}: a list starts empty`);
    if (r.retime !== "" && r.kind !== "float") out.push(`${r.name}: only a multiplier re-times anything`);
    // A speed setting divides a time, so its least value must be above 0.
    if (r.retime === "speed" && !(r.min > 0)) out.push(`${r.name}: what time is divided by has a least value above 0`);
    if (r.at === "mode" && r.kind === "flag") out.push(`${r.name}: Game.ini has no flags`);
    if (r.status === "live" && !r.live && AT_START[key.startsWith("-") ? `-${r.name}` : r.name] === undefined) out.push(`${r.name}: a setting that takes effect may change while the server runs, or AT_START says why not`);
  }
  return out;
}

export function catalogCounts(): { live: number; todo: number; planned: number; none: number; all: number } {
  const n = { live: 0, todo: 0, planned: 0, none: 0, all: CATALOG.length };
  for (const r of CATALOG) n[r.status]++;
  return n;
}
