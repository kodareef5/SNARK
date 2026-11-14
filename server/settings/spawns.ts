// The spawn tables the content gives, as the server's settings change them: ConfigOverrideNPCSpawnEntriesContainer replaces a
// table, ConfigAddNPCSpawnEntriesContainer adds to it and ConfigSubtractNPCSpawnEntriesContainer takes species out of it, in
// that order; NPCReplacements puts one species in place of another, and DinoSpawnWeightMultipliers scales a species' weight
// and limit. Names are content ids (DEV81). One that names nothing this build has is reported, never an error.

import type { SpawnsDef } from "../../shared/content/defs.ts";
import type { Registry } from "../../shared/content/registry.ts";
import { field, isList, toNumber, toSwitch, unquote, type IniList, type IniNode } from "./ini.ts";
import type { Lists } from "./lists.ts";
import type { Rules } from "./rules.ts";

/** A group a region may add, drawn by weight: each member's content index, the chance it comes, and its offset in metres. */
export interface Entry {
  readonly kinds: readonly number[];
  readonly chances: readonly number[];
  readonly offsets: readonly (readonly [number, number])[];
  readonly weight: number;
}

export interface SpawnTable {
  readonly entries: readonly Entry[];
  /** The most of a region's creatures each species may be, as a share of the number it holds. */
  readonly limits: ReadonlyMap<number, number>;
}

interface Member {
  id: string;
  chance: number;
  offset: readonly [number, number];
}

interface Table {
  entries: { members: Member[]; weight: number }[];
  limits: Map<string, number>;
}

/** ARK writes offsets in its units, which are centimetres. */
const UNITS = 100;

const words = (n: IniNode | undefined): string => (typeof n === "string" ? unquote(n) : "");
const number = (n: IniNode | undefined): number => (typeof n === "string" ? toNumber(n) : NaN);
const items = (n: IniNode | undefined): readonly IniNode[] => (isList(n) ? n.items.map((i) => i.value) : []);

function fromDef(d: SpawnsDef): Table {
  return {
    entries: d.entries.map((e) => ({ weight: e.weight, members: e.group.map((id, i) => ({ id, chance: e.chances?.[i] ?? 1, offset: e.offsets?.[i] ?? [0, 0] })) })),
    limits: new Map((d.limits ?? []).map((l) => [l.species, l.share])),
  };
}

/** Each spawn table by its content index, and what the settings asked that could not be done. */
export function spawnTables(reg: Registry, rules: Rules, lists: Lists): { tables: Map<number, SpawnTable>; passed: string[] } {
  const passed: string[] = [];
  const tables = new Map<number, Table>();
  reg.defs.forEach((d, k) => {
    if (d?.type === "spawns") tables.set(k, fromDef(d));
  });
  const tableOf = (setting: string, entry: IniList): Table | null => {
    const [k] = lists.of(setting, words(field(entry, "NPCSpawnEntriesContainerClassString")), "spawns");
    return k === undefined ? null : tables.get(k)!;
  };
  const species = (setting: string, name: IniNode | undefined): string[] => lists.ids(setting, words(name), "species");
  /** An entry's members, leaving out a name this build lacks along with its chance and offset. */
  const membersOf = (setting: string, one: IniList): Member[] => {
    const chances = items(field(one, "NPCsToSpawnPercentageChance"));
    const offsets = items(field(one, "NPCsSpawnOffsets"));
    return items(field(one, "NPCsToSpawnStrings")).flatMap((name, i) => {
      const chance = number(chances[i]);
      const o = offsets[i];
      const offset = isList(o) ? ([(number(field(o, "X")) || 0) / UNITS, (number(field(o, "Y")) || 0) / UNITS] as const) : ([0, 0] as const);
      return species(setting, name).map((id) => ({ id, chance: chance >= 0 ? Math.min(1, chance) : 1, offset }));
    });
  };
  const entriesIn = (setting: string, entry: IniList): Table["entries"] =>
    items(field(entry, "NPCSpawnEntries")).flatMap((one) => {
      if (!isList(one)) return [];
      const members = membersOf(setting, one);
      const weight = number(field(one, "EntryWeight"));
      if (members.length === 0) return [];
      if (!(weight >= 0)) {
        passed.push(`${setting}: the entry for ${members.map((m) => m.id).join(", ")} wants an EntryWeight`);
        return [];
      }
      return [{ members, weight }];
    });
  const limitsIn = (setting: string, entry: IniList, needShare: boolean): [string, number][] =>
    items(field(entry, "NPCSpawnLimits")).flatMap((one) => {
      if (!isList(one)) return [];
      const share = number(field(one, "MaxPercentageOfDesiredNumToAllow"));
      const ids = species(setting, field(one, "NPCClassString"));
      if (needShare && ids.length > 0 && !(share >= 0)) passed.push(`${setting}: the limit for ${ids.join(", ")} wants a MaxPercentageOfDesiredNumToAllow`);
      return needShare && !(share >= 0) ? [] : ids.map((id): [string, number] => [id, share]);
    });

  for (const entry of rules.list("ConfigOverrideNPCSpawnEntriesContainer")) {
    const t = isList(entry) ? tableOf("ConfigOverrideNPCSpawnEntriesContainer", entry) : null;
    if (!t) continue;
    t.entries = entriesIn("ConfigOverrideNPCSpawnEntriesContainer", entry as IniList);
    t.limits = new Map(limitsIn("ConfigOverrideNPCSpawnEntriesContainer", entry as IniList, true));
  }
  for (const entry of rules.list("ConfigAddNPCSpawnEntriesContainer")) {
    const t = isList(entry) ? tableOf("ConfigAddNPCSpawnEntriesContainer", entry) : null;
    if (!t) continue;
    t.entries.push(...entriesIn("ConfigAddNPCSpawnEntriesContainer", entry as IniList));
    for (const [id, share] of limitsIn("ConfigAddNPCSpawnEntriesContainer", entry as IniList, true)) t.limits.set(id, share);
  }
  // A species named goes from every group of the table, and a group left with nobody goes with it.
  for (const entry of rules.list("ConfigSubtractNPCSpawnEntriesContainer")) {
    const t = isList(entry) ? tableOf("ConfigSubtractNPCSpawnEntriesContainer", entry) : null;
    if (!t) continue;
    const gone = new Set(items(field(entry as IniList, "NPCSpawnEntries")).flatMap((one) => (isList(one) ? membersOf("ConfigSubtractNPCSpawnEntriesContainer", one).map((m) => m.id) : [])));
    t.entries = t.entries.map((e) => ({ ...e, members: e.members.filter((m) => !gone.has(m.id)) })).filter((e) => e.members.length > 0);
    for (const [id] of limitsIn("ConfigSubtractNPCSpawnEntriesContainer", entry as IniList, false)) t.limits.delete(id);
  }

  // One species for another. With no ToClassName, the species is not spawned at all.
  const replace = new Map<string, string | null>();
  for (const entry of rules.list("NPCReplacements")) {
    if (!isList(entry)) continue;
    const toName = words(field(entry, "ToClassName"));
    const to = toName === "" ? [] : species("NPCReplacements", field(entry, "ToClassName"));
    if (toName !== "" && to.length === 0) continue;
    for (const id of species("NPCReplacements", field(entry, "FromClassName"))) replace.set(id, to[0] ?? null);
  }

  // By the species' tag, which ARK calls its DinoNameTag.
  const scale = new Map<number, { weight: number; limit: number | null }>();
  for (const entry of rules.list("DinoSpawnWeightMultipliers")) {
    if (!isList(entry)) continue;
    const tag = words(field(entry, "DinoNameTag")).toLowerCase();
    const kinds = reg.tags.get(tag) ?? [];
    if (kinds.length === 0) {
      passed.push(`DinoSpawnWeightMultipliers: no creature here has the tag "${tag}"`);
      continue;
    }
    const weight = number(field(entry, "SpawnWeightMultiplier"));
    const override = toSwitch(words(field(entry, "OverrideSpawnLimitPercentage"))) === true;
    const limit = number(field(entry, "SpawnLimitPercentage"));
    for (const k of kinds) scale.set(k, { weight: weight >= 0 ? weight : 1, limit: override && limit >= 0 ? limit : null });
  }

  const kindOf = (id: string): number => {
    const now = replace.has(id) ? replace.get(id)! : id;
    return now === null ? 0 : reg.index.get(now)!;
  };
  const out = new Map<number, SpawnTable>();
  for (const [k, t] of tables) {
    const entries: Entry[] = [];
    for (const e of t.entries) {
      const members = e.members.flatMap((m) => {
        const kind = kindOf(m.id);
        return kind === 0 ? [] : [{ kind, chance: m.chance, offset: m.offset }];
      });
      const weight = members.length === 0 ? 0 : e.weight * (scale.get(members[0]!.kind)?.weight ?? 1);
      if (weight > 0) entries.push({ kinds: members.map((m) => m.kind), chances: members.map((m) => m.chance), offsets: members.map((m) => m.offset), weight });
    }
    const limits = new Map<number, number>();
    for (const [id, share] of t.limits) {
      const kind = kindOf(id);
      if (kind !== 0) limits.set(kind, share);
    }
    for (const [kind, s] of scale) if (s.limit !== null) limits.set(kind, s.limit);
    out.set(k, { entries, limits });
  }
  return { tables: out, passed };
}
