// Public reference pages read command metadata and a small gameplay allowlist. No command is run and no server is opened.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Console } from "../../server/console.ts";
import { addAdminCommands } from "../../server/commands/admin.ts";
import { addClusterCommands } from "../../server/commands/cluster.ts";
import { addCombatCommands } from "../../server/commands/combat.ts";
import { addCoreCommands } from "../../server/commands/core.ts";
import { addCreatureCommands } from "../../server/commands/creatures.ts";
import { addSettingsCommands } from "../../server/commands/settings.ts";
import { addSocialCommands } from "../../server/commands/social.ts";
import { rowOf } from "../../server/settings/catalog.ts";
import { GAME_FILE, GUS_FILE, LIVE_FILE } from "../../server/settings/config.ts";
import type { Row } from "../../server/settings/row.ts";
import type { GuideData, GuideMap } from "../../shared/pages/types.ts";
import { PUBLIC_SETTINGS } from "../../shared/pages/validate.ts";
import { escape, icon, mapPath, routeId, sectionHead, serverPath } from "./view/html.ts";
import { filterBar, heading, layout, noResults } from "./view/layout.ts";

export interface CommandReference {
  name: string;
  usage: string;
  description: string;
  group: string;
  access: "player" | "admin" | "operator";
  examples: string[];
  notes: string[];
}

const EXAMPLES: Readonly<Record<string, readonly string[]>> = {
  help: ["help give", "help spawn"],
  enablecheats: ['enablecheats "<password>"'],
  spectate: ["spectate", "stopspectating"],
  settime: ["settime 6:30"],
  give: ["give core:spear 1", "give core:spear 1 apprentice bp"],
  spawn: ["spawn core:raptor 30 3"],
  setstat: ["setstat health 10"],
  addxp: ["addxp 100"],
  kit: ["kit tools", "kit bow"],
  armor: ["armor hide", "armor off"],
  dummy: ["dummy cloth"],
  buff: ["buff burning 10", "buff off burning"],
  setting: ["setting TamingSpeedMultiplier", "setting TamingSpeedMultiplier 2"],
  tribe: ['tribe create "Example Tribe"'],
  travel: ["travel"],
  cluster: ["cluster audit"],
};
const NOTES: Readonly<Record<string, readonly string[]>> = {
  enablecheats: ["Replace <password> with the password supplied by your server operator. This wiki never receives it."],
  spectate: ["Requires a session; availability follows the server's spectator policy."],
  stopspectating: ["Requires an existing spectator session."],
  saveas: ["Operator terminal only; this command is refused from player sessions."],
  destroywilddinos: ["Affects every wild creature in this world, including what it carries."],
  hatch: ["The all argument affects every egg and pregnancy in this world."],
  travel: ["Requires a configured cluster. Listing destinations works without a survivor; travelling requires one."],
  setting: ["A console change lasts until restart. Only settings marked changeable while running accept a new value."],
  forceupdatedynamicconfig: ["The operator must enable dynamic configuration before the live file is read."],
};

/** Registers the same command families as Host, then projects only documentation fields. */
export function buildCommandReference(): CommandReference[] {
  const console = new Console();
  const groups = new Map<string, string>();
  const register = (group: string, add: (console: Console) => void): void => {
    const before = new Set(console.commands.keys());
    add(console);
    for (const name of console.commands.keys()) if (!before.has(name)) groups.set(name, group);
  };
  register("Session & world", addCoreCommands);
  register("Movement & creation", addAdminCommands);
  register("Combat & equipment", addCombatCommands);
  register("Tribe & communication", addSocialCommands);
  register("Creatures & breeding", addCreatureCommands);
  register("Configuration", addSettingsCommands);
  register("Cluster", addClusterCommands);
  return [...console.commands.values()].map((command): CommandReference => ({
    name: command.name, usage: command.usage, description: command.help,
    group: groups.get(command.name)!, access: command.name === "saveas" ? "operator" : command.admin ? "admin" : "player",
    examples: [...EXAMPLES[command.name] ?? []], notes: [...NOTES[command.name] ?? []],
  })).sort((a, b) => a.name.localeCompare(b.name));
}

export interface SettingReference {
  key: string;
  value: string;
  default: string;
  changed: boolean;
  description: string;
  group: string;
  kind: "bool" | "int" | "float";
  min: number;
  max: number;
  live: boolean;
  file: string;
  section: string;
}
export interface IniExcerpt { filename: string; label: string; description: string; text: string; count: number }
export interface MapSettingsReference {
  id: string;
  label: string;
  source: "defaults" | "snapshot";
  sampledAt: string | null;
  settings: SettingReference[];
  files: IniExcerpt[];
}

const PUBLIC = new Map<string, string>(PUBLIC_SETTINGS.map((key) => [key.toLowerCase(), key]));
const FILES = new Map([
  ["server", { file: GUS_FILE, section: "ServerSettings" }],
  ["mode", { file: GAME_FILE, section: "/script/shootergame.shootergamemode" }],
  ["snark", { file: GUS_FILE, section: "SnarkSettings" }],
]);
const publicRows = (): Row[] => PUBLIC_SETTINGS.map((key) => rowOf(key)!).filter((row) => row.status === "live" && FILES.has(row.at));

function iniValue(row: Row, value: unknown): string {
  if (row.kind === "bool") {
    if (value === true || value === "On" || value === "True") return "True";
    if (value === false || value === "Off" || value === "False") return "False";
    throw new Error(`invalid public switch ${row.name}`);
  }
  if (row.kind !== "int" && row.kind !== "float") throw new Error(`unsupported public setting ${row.name}`);
  if (typeof value !== "number" && (typeof value !== "string" || !/^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(value))) throw new Error(`invalid public value ${row.name}`);
  const number = Number(value);
  if (!Number.isFinite(number) || number < row.min || number > row.max || (row.kind === "int" && !Number.isInteger(number))) throw new Error(`public value out of range: ${row.name}`);
  return String(number);
}

function referenceSetting(row: Row, value: unknown): SettingReference {
  const place = FILES.get(row.at)!;
  const canonical = iniValue(row, value), fallback = iniValue(row, row.def);
  return { key: PUBLIC.get(row.name.toLowerCase())!, value: canonical, default: fallback, changed: canonical !== fallback, description: row.doc,
    group: row.group, kind: row.kind as SettingReference["kind"], min: row.min, max: row.max, live: row.live, ...place };
}

/** Standalone excerpts contain only known numeric/boolean gameplay keys and parser-correct sections. */
export function buildIniExcerpts(mapId: string, reference: Pick<MapSettingsReference, "source" | "sampledAt" | "settings">): IniExcerpt[] {
  routeId(mapId);
  if (reference.sampledAt !== null && (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(reference.sampledAt) || !Number.isFinite(Date.parse(reference.sampledAt)))) throw new Error("invalid reference capture time");
  const settings = reference.settings.map((s) => {
    const row = PUBLIC.has(s.key.toLowerCase()) ? rowOf(s.key) : undefined;
    if (!row || row.status !== "live" || !FILES.has(row.at)) throw new Error("only effective public gameplay settings may enter an INI excerpt");
    return referenceSetting(row, s.value);
  });
  if (new Set(settings.map((s) => s.key)).size !== settings.length) throw new Error("duplicate public setting");
  const header = [`; Public gameplay excerpt — ${reference.source === "defaults" ? "engine defaults" : "captured values"}`, `; Map: ${mapId}`,
    ...(reference.sampledAt ? [`; Captured: ${reference.sampledAt}`, "; Effective values: review existing startup factors and overrides before applying."] : []), "; Merge selected keys into your existing configuration."];
  const files: IniExcerpt[] = [];
  for (const filename of [GUS_FILE, GAME_FILE]) {
    const rows = settings.filter((s) => s.file === filename);
    if (!rows.length) continue;
    const lines = [...header];
    for (const section of [...new Set(rows.map((s) => s.section))]) lines.push("", `[${section}]`, ...rows.filter((s) => s.section === section).map((s) => `${s.key}=${s.value}`));
    files.push({ filename, label: filename, description: "Startup gameplay values, in their correct INI sections.", text: `${lines.join("\n")}\n`, count: rows.length });
  }
  const live = settings.filter((s) => s.live);
  if (live.length) files.push({ filename: LIVE_FILE, label: LIVE_FILE, description: "Only values that may change while running. Requires dynamic configuration to be enabled.", text: `${[...header, "; Enable -UseDynamicConfig; this file has no sections.", "", ...live.map((s) => `${s.key}=${s.value}`)].join("\n")}\n`, count: live.length });
  return files;
}

/** Multiple servers on one map stay separate; absent snapshot keys are never filled with invented effective values. */
export function buildMapSettings(data: GuideData, mapId: string): MapSettingsReference[] {
  const rows = publicRows(), byKey = new Map(rows.map((row) => [row.name.toLowerCase(), row]));
  const captured = data.cluster.mode === "snapshot" ? data.servers.filter((server) => server.mapId === mapId && server.sampledAt !== null) : [];
  const references: MapSettingsReference[] = captured.length ? captured.map((server) => {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(server.id)) throw new Error("unsafe public server ID");
    const seen = new Set<string>();
    const settings = server.settings.flatMap((s) => {
      const row = byKey.get(s.key.toLowerCase());
      if (!row) return [];
      if (seen.has(s.key)) throw new Error("duplicate public setting");
      seen.add(s.key);
      return [referenceSetting(row, s.value)];
    });
    return { id: server.id, label: server.label, source: "snapshot", sampledAt: server.sampledAt, settings, files: [] };
  }) : [{ id: "defaults", label: "Engine defaults", source: "defaults", sampledAt: null, settings: rows.map((row) => referenceSetting(row, row.def)), files: [] }];
  for (const reference of references) {
    reference.settings.sort((a, b) => a.key.localeCompare(b.key));
    reference.files = buildIniExcerpts(mapId, reference);
  }
  return references;
}

function commandPage(commands: CommandReference[]): string {
  const access = { player: "Player", admin: "Cheats enabled", operator: "Operator terminal" };
  return `${heading("Admin & commands", "Console reference", "The commands this build actually accepts, with syntax, examples and access requirements.")}
  <section class="reference-intro prose"><h2>Use the in-game console</h2><p>Press <kbd>Tab</kbd> or <kbd>\u0060</kbd>, then type <code>help</code>. Command names are case-insensitive. Separate arguments with spaces; double quotes keep a name together. Angle brackets mean required arguments; square brackets mean optional arguments.</p><p>Cheat commands require <code>enablecheats &quot;&lt;password&gt;&quot;</code> for your session. The operator terminal already has permission. Many commands still need an in-game survivor or a target. These pages are reference only.</p></section>
  <section data-filter-area>${sectionHead("Command index", `${commands.length} commands registered in this build.`)}${filterBar(commands.length, Object.entries(access).map(([value, label]) => ({ value, label })), "Find a command, action or example")}<div class="command-list" data-record-list>${commands.map((command) => `<article id="${command.name}" class="command-card" data-record data-name="${command.name}" data-kind="${command.access}" data-query="${escape(`${command.name} ${command.usage} ${command.description} ${command.group} ${command.examples.join(" ")}`.toLowerCase())}"><div class="command-meta"><span class="eyebrow">${escape(command.group)}</span><span class="status-tag">${access[command.access]}</span></div><h3><a href="#${command.name}">${command.name}</a></h3><pre class="command-syntax"><code>${escape(`${command.name}${command.usage ? ` ${command.usage}` : ""}`)}</code></pre><p>${escape(command.description)}</p>${command.examples.length ? `<details><summary>Examples</summary><pre class="reference-code"><code>${escape(command.examples.join("\n"))}</code></pre></details>` : ""}${command.notes.map((note) => `<p class="command-note">${escape(note)}</p>`).join("")}</article>`).join("")}</div>${noResults}</section>`;
}

export const mapSettingsPath = (mapId: string): string => `${mapPath(mapId)}settings/`;
const excerptPath = (mapId: string, reference: MapSettingsReference, file: IniExcerpt): string => `${mapSettingsPath(mapId)}${reference.source === "defaults" ? "defaults" : `servers/${routeId(reference.id)}`}/${file.filename}`;

function settingsPage(map: GuideMap, references: MapSettingsReference[]): string {
  const sampled = references.some((r) => r.source === "snapshot");
  return `${heading(`${map.label} settings`, "Map configuration", sampled ? "Published gameplay values, separated by server and capture time." : "Engine defaults. No server snapshot for this map is connected.")}
  <nav class="section-nav" aria-label="Map pages"><a href="${mapPath(map.id)}">Atlas</a><a href="${mapSettingsPath(map.id)}" aria-current="page">Settings & INI</a><a href="/commands/#setting">Console commands</a></nav>
  <section class="reference-intro prose"><h2>INI files, ready to inspect</h2><p>This engine reads <code>${GUS_FILE}</code> and <code>${GAME_FILE}</code>. Downloads below are gameplay excerpts for this map's server, using the same keys and sections as the game. Merge selected values into your existing configuration; these are not full server configurations.</p><p>Startup files are read first, then command-line overrides and single-player factors. When enabled with <code>-UseDynamicConfig</code>, <code>${LIVE_FILE}</code> supplies later values for changeable settings. <a href="/commands/#forceupdatedynamicconfig"><code>forceupdatedynamicconfig</code></a> requests a reread. <a href="/commands/#setting"><code>setting</code></a> changes a value until restart.</p></section>
  ${references.map((reference) => `<section class="reference-settings" id="${reference.source === "defaults" ? "defaults" : `server-${reference.id}`}">${sectionHead(reference.label, reference.sampledAt ? `Captured ${reference.sampledAt}. Only published keys are shown; omitted values are unknown.` : "Defaults shared by this build's maps; no per-map overrides are inferred.", reference.source === "snapshot" ? { href: serverPath(reference.id), label: "Server page" } : undefined)}<div class="reference-files">${reference.files.map((file) => `<article class="reference-download"><span class="eyebrow">${file.count} gameplay values</span><h3>${escape(file.label)}</h3><p>${escape(file.description)}</p><a class="button" href="${excerptPath(map.id, reference, file)}" download="${file.filename}">Download INI ${icon("arrow")}</a><details><summary>Preview excerpt</summary><pre class="reference-code"><code>${escape(file.text)}</code></pre></details></article>`).join("")}</div><div data-filter-area>${filterBar(reference.settings.length, [], "Find a gameplay setting")}<label class="changes-toggle"><input type="checkbox" data-changes-only> Show changes from default</label><div class="table-wrap"><table class="settings-table"><thead><tr><th>Setting</th><th>${reference.source === "snapshot" ? "Captured value" : "Value"}</th><th>Engine default</th><th>Configuration</th></tr></thead><tbody data-record-list>${reference.settings.map((setting) => `<tr data-record data-name="${setting.key.toLowerCase()}" data-query="${escape(`${setting.key} ${setting.description} ${setting.group} ${setting.file}`.toLowerCase())}" data-changed="${setting.changed}"><td><strong>${setting.key}</strong><small>${escape(setting.group)}</small><p>${escape(setting.description)}</p></td><td${setting.changed ? ' class="changed"' : ""}>${setting.value}</td><td>${setting.default}</td><td><code>${setting.file}</code><p>${setting.live ? "May change while running" : "Read at startup"}</p><small>${setting.kind === "bool" ? "True / False" : `${setting.min}–${setting.max}${setting.kind === "int" ? " · whole numbers" : ""}`}</small></td></tr>`).join("")}</tbody></table></div>${noResults}</div>${!reference.settings.length ? '<p class="muted">No supported gameplay values were included in this snapshot.</p>' : ""}</section>`).join("")}`;
}

/** Complete HTML and parser-compatible INI files; browser code only enhances the existing text filters. */
export async function renderReference(data: GuideData, outDir: string): Promise<void> {
  const write = async (path: string, content: string): Promise<void> => {
    const parts = path.split("/").filter(Boolean), file = parts.pop()!;
    const dir = join(outDir, ...parts);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, file), content);
  };
  const commands = buildCommandReference();
  await write("commands/index.html", layout(data, "Admin & commands", "commands", commandPage(commands)));
  for (const map of data.maps) {
    const references = buildMapSettings(data, map.id);
    await write(`${mapSettingsPath(map.id)}index.html`, layout(data, `${map.label} settings`, "atlas", settingsPage(map, references), [{ label: "World atlas", href: "/maps/" }, { label: map.label, href: mapPath(map.id) }]));
    for (const reference of references) for (const file of reference.files) await write(excerptPath(map.id, reference, file), file.text);
  }
}
