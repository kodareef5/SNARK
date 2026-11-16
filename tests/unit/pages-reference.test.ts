import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tokenize } from "../../shared/console.ts";
import type { GuideData, GuideServer } from "../../shared/pages/types.ts";
import { PUBLIC_SETTINGS, validatePublicSnapshot } from "../../shared/pages/validate.ts";
import { rowOf } from "../../server/settings/catalog.ts";
import { GAME_FILE, GUS_FILE, LIVE_FILE, loadConfig } from "../../server/settings/config.ts";
import { buildServers } from "../../tools/pages/catalogue.ts";
import { buildCommandReference, buildIniExcerpts, buildMapSettings, renderReference } from "../../tools/pages/reference.ts";

function fixture(): GuideData {
  return { version: 1, generatedAt: "2026-11-16T12:00:00.000Z", revision: "12345678", cluster: { id: "local", label: "Example", mode: "catalogue", description: "" },
    entries: [], models: {}, sounds: [], music: [], servers: [],
    maps: [{ id: "core:miami", label: "Miami", description: "", image: "", width: 768, height: 768, metres: 8128, layers: [], places: [], facts: [], credit: "" }],
  };
}
function server(id = "east"): GuideServer {
  return { id, label: `Server ${id}`, mapId: "core:miami", sampledAt: "2026-11-16T12:00:00.000Z", players: [], capacity: 32, facts: [], settings: [
    { key: "TamingSpeedMultiplier", label: "unused", value: "2.5", default: "1", group: "", description: "" },
    { key: "ServerPVE", label: "unused", value: "On", default: "Off", group: "", description: "" },
    { key: "BabyMatureSpeedMultiplier", label: "unused", value: "4.5", default: "1", group: "", description: "" },
  ] };
}

test("reference registration stays in step with the real host's command families", async () => {
  const host = await readFile(new URL("../../server/host.ts", import.meta.url), "utf8");
  const reference = await readFile(new URL("../../tools/pages/reference.ts", import.meta.url), "utf8");
  const actual = [...host.matchAll(/^\s+(add\w+Commands)\(con\);/gm)].map((m) => m[1]!).sort();
  const documented = [...reference.matchAll(/register\("[^"]+", (add\w+Commands)\);/g)].map((m) => m[1]!).sort();
  expect(actual.length).toBeGreaterThan(0);
  expect(documented).toEqual(actual);
});

test("command reference projects real parser metadata, access requirements and valid example command names", () => {
  const commands = buildCommandReference(), byName = new Map(commands.map((c) => [c.name, c]));
  for (const name of ["help", "enablecheats", "give", "spawn", "forcetame", "god", "fly", "ghost", "walk", "setting", "forceupdatedynamicconfig", "tribe", "travel", "cluster", "saveas", "loot"]) expect(byName.has(name)).toBe(true);
  expect(byName.get("give")?.usage).toBe("<item> [count] [quality] [bp]");
  expect(byName.get("give")?.access).toBe("admin");
  expect(byName.get("help")?.access).toBe("player");
  expect(byName.get("saveas")?.access).toBe("operator");
  expect(byName.get("spectate")?.notes.join(" ")).toContain("spectator policy");
  expect(byName.has("gfi")).toBe(false); // Do not invent familiar ARK aliases that the parser does not accept.
  expect(commands.length).toBe(new Set(commands.map((c) => c.name)).size);
  for (const command of commands) {
    expect(Object.keys(command).sort()).toEqual(["access", "description", "examples", "group", "name", "notes", "usage"]);
    expect(command.description.length).toBeGreaterThan(0);
    for (const example of command.examples) {
      expect(example.length).toBeLessThanOrEqual(66);
      expect(byName.has(tokenize(example)[0]!)).toBe(true);
    }
  }
});

test("default INI excerpts round-trip through the real engine parser and contain only effective public gameplay keys", () => {
  const reference = buildMapSettings(fixture(), "core:miami")[0]!;
  expect(reference.source).toBe("defaults");
  expect(reference.sampledAt).toBeNull();
  expect(reference.files.map((f) => f.filename)).toEqual([GUS_FILE, GAME_FILE, LIVE_FILE]);
  const text = (name: string): string => reference.files.find((f) => f.filename === name)!.text;
  const { rules, report } = loadConfig({ gus: text(GUS_FILE), game: text(GAME_FILE), live: text(LIVE_FILE) }, ["-UseDynamicConfig"]);
  expect(report.refused).toEqual([]);
  expect(report.unknown).toEqual([]);
  expect(report.waiting).toEqual([]);
  for (const setting of reference.settings) {
    expect((PUBLIC_SETTINGS as readonly string[]).includes(setting.key)).toBe(true);
    expect(rowOf(setting.key)!.status).toBe("live");
    expect(rules.valueOf(rowOf(setting.key)!)).toEqual(rowOf(setting.key)!.def as number | boolean);
    expect(setting.changed).toBe(false);
    if (!setting.live) expect(text(LIVE_FILE)).not.toContain(`${setting.key}=`);
  }
  expect(text(GUS_FILE)).toContain("[ServerSettings]");
  expect(text(GAME_FILE)).toContain("[/script/shootergame.shootergamemode]");
  expect(text(LIVE_FILE)).not.toMatch(/^\[/m);
});

test("matching captures stay separate and missing values never inherit engine defaults", () => {
  const data = fixture(); data.cluster.mode = "snapshot";
  data.servers = [server("east"), server("west"), { ...server("other"), mapId: "core:tampa" }];
  data.servers[1]!.settings = [{ ...data.servers[0]!.settings[0]!, value: "3" }];
  const references = buildMapSettings(data, "core:miami");
  expect(references.map((r) => r.id)).toEqual(["east", "west"]);
  expect(references.map((r) => r.settings.length)).toEqual([3, 1]);
  for (const reference of references) {
    expect(reference.source).toBe("snapshot");
    const texts = new Map(reference.files.map((f) => [f.filename, f.text]));
    const { rules, report } = loadConfig({ gus: texts.get(GUS_FILE), game: texts.get(GAME_FILE), live: texts.get(LIVE_FILE) }, ["-UseDynamicConfig"]);
    expect(report.refused).toEqual([]);
    expect(report.unknown).toEqual([]);
    for (const setting of reference.settings) expect(String(rules.valueOf(rowOf(setting.key)!)).toLowerCase()).toBe(setting.value.toLowerCase());
    expect(reference.files.map((f) => f.text).join("\n")).not.toContain("XPMultiplier=");
  }
  expect(buildMapSettings(data, "core:las-vegas")[0]!.source).toBe("defaults");
  data.cluster.mode = "catalogue";
  expect(buildMapSettings(data, "core:miami")[0]!.source).toBe("defaults");
});

test("captured numeric settings retain precision through public projection and INI export", () => {
  const data = fixture(); data.cluster.mode = "snapshot";
  data.servers = buildServers({ version: 1, servers: [{ id: "rates", label: "Rates", mapId: "core:miami", sampledAt: "2026-11-16T12:00:00Z", players: [], capacity: 32, settings: { HarvestXPMultiplier: 1e-7 } }] });
  const reference = buildMapSettings(data, "core:miami")[0]!;
  const ini = reference.files.find((f) => f.filename === GAME_FILE)!.text;
  const { rules, report } = loadConfig({ game: ini });
  expect(report.refused).toEqual([]);
  expect(rules.num("HarvestXPMultiplier")).toBe(1e-7);
});

test("INI output revalidates values and omits private or unsupported source fields", () => {
  const data = fixture(); data.cluster.mode = "snapshot"; data.servers = [server()];
  data.servers[0]!.settings.push({ key: "ServerAdminPassword", label: "SECRET_LABEL", value: "SECRET_VALUE", default: "", group: "", description: "" });
  const reference = buildMapSettings(data, "core:miami")[0]!;
  expect(JSON.stringify(reference)).not.toContain("SECRET_");
  const injected = { ...reference, settings: [{ ...reference.settings[0]!, value: "2\nServerAdminPassword=SECRET" }] };
  expect(() => buildIniExcerpts("core:miami", injected)).toThrow("invalid public value");
  expect(() => buildIniExcerpts("core:../miami", reference)).toThrow("Unsafe guide id");
  expect(() => buildIniExcerpts("core:miami", { ...reference, settings: [...reference.settings, reference.settings[0]!] })).toThrow("duplicate");
  data.servers[0]!.settings[0]!.value = "Infinity";
  expect(() => buildMapSettings(data, "core:miami")).toThrow("invalid public value");
  const snapshot = { version: 1, servers: [{ id: "east", label: "East", mapId: "core:miami", sampledAt: "2026-11-16T12:00:00Z", players: [], capacity: 32, settings: { CropGrowthSpeedMultiplier: 2 } }] };
  expect(() => validatePublicSnapshot(snapshot)).toThrow("field is not public");
});

test("reference renders static searchable commands and per-map INI downloads with escaped labels", async () => {
  const data = fixture(); data.cluster.mode = "snapshot"; data.servers = [server()];
  data.servers[0]!.label = '<script>SECRET_LABEL</script>\nServerAdminPassword=oops';
  const root = await mkdtemp(join(tmpdir(), "snark-reference-"));
  try {
    await renderReference(data, root);
    const commands = await readFile(join(root, "commands/index.html"), "utf8");
    const settings = await readFile(join(root, "maps/core/miami/settings/index.html"), "utf8");
    expect(commands).toContain("data-filter-query");
    expect(commands).toContain('id="spawn"');
    expect(commands).toContain("Operator terminal");
    expect(commands).toContain("give core:spear 1");
    expect(settings).toContain("&lt;script&gt;SECRET_LABEL&lt;/script&gt;");
    expect(settings).not.toContain("<script>SECRET_LABEL");
    expect(settings).toContain("omitted values are unknown");
    expect(settings).toContain("Captured value");
    expect(settings).not.toMatch(/\s(?:onclick|onload|style)=/);
    const downloads = [...settings.matchAll(/href="([^"]+\.ini)"/g)];
    expect(downloads.length).toBe(3);
    for (const match of downloads) {
      const file = await readFile(join(root, match[1]!), "utf8");
      expect(file).not.toContain("SECRET_");
      expect(file).not.toContain("ServerAdminPassword");
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
