import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { GuideData, GuideEntry, GuideSound } from "../../shared/pages/types.ts";
import { mapTransform, matchesGuideQuery, searchTerms } from "../../client/core/pages/filter.ts";
import { renderGuide } from "../../tools/pages/presentation.ts";
import { entryPath, localUrl, routeId } from "../../tools/pages/view/html.ts";

const knife: GuideEntry = { id: "core:knife", kind: "items", classId: "item/weapon", label: "Stone knife", description: "A simple cutting tool.", status: "built", tags: ["stone"], facts: [{ label: "Weight", value: "2", unit: "kg" }], links: [] };
const sound = (take: number): GuideSound => ({ id: `core:knife/sound/use/take/${take}`, owner: "core:knife", label: "Cut", occasion: "use", url: `/media/sound-${take}.opus`, seconds: 2.3, loop: false, usage: "game", take });
const fixture = (): GuideData => ({
  version: 1, generatedAt: "2026-11-16T12:00:00.000Z", revision: "12345678", cluster: { id: "local", label: "Local cluster", mode: "catalogue", description: "The content of this build." },
  entries: [{ ...knife }], models: {}, maps: [{ id: "core:island", label: "Island", description: "Authored terrain", image: "/media/map.png", width: 768, height: 768, metres: 4000, layers: [{ id: "roads", label: "Roads", image: "/media/roads.png" }], places: [{ id: "beach", label: "Beach", x: .3, y: .5, kind: "spawn" }], facts: [], credit: "Map source" }],
  servers: [{ id: "island", label: "Island reference", mapId: "core:island", sampledAt: null, players: [], capacity: null, settings: [{ key: "XP", label: "Experience", value: "1", default: "1", group: "Rates", description: "Experience rate" }], facts: [] }],
  sounds: [sound(1)], music: [{ id: "dawn", label: "Dawn", bpm: 80, seconds: 120, layers: [{ name: "calm", url: "/media/dawn.opus" }] }],
});

async function rendered(work: (dir: string, data: GuideData) => Promise<void>, data = fixture()): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "snark-guide-ui-"));
  try { await renderGuide(data, dir); await work(dir, data); }
  finally { await rm(dir, { recursive: true, force: true }); }
}

test("guide pages have complete deep links and ordinary HTML without a client router", async () => {
  await rendered(async (dir, data) => {
    for (const route of ["", "items", "items/core/knife", "maps", "maps/core/island", "sounds", "sounds/core/knife", "music", "music/dawn", "servers/island", "servers/island/settings", "servers/island/players", "servers/island/stats", "search", "credits"]) {
      const html = await readFile(join(dir, route, "index.html"), "utf8");
      expect(html).toContain('<html lang="en">');
      expect(html).toContain('<main id="content">');
      expect(html).toContain('/assets/guide.js');
      expect(html).not.toMatch(/\s(?:onclick|onload|style)=/);
      for (const match of html.matchAll(/href="([^"]+)"/g)) {
        const path = match[1]!.split(/[?#]/)[0]!;
        if (!path.startsWith("/") || path.startsWith("/assets/") || path.startsWith("/media/")) continue;
        expect((await stat(join(dir, path, "index.html"))).isFile()).toBe(true);
      }
    }
    expect(entryPath(data.entries[0]!)).toBe("/items/core/knife/");
    expect(await readFile(join(dir, "items/core/knife/index.html"), "utf8")).toContain("Stone knife");
    expect(await readFile(join(dir, "maps/core/island/index.html"), "utf8")).toContain('data-map-layer="roads"');
  });
});

test("untrusted labels and character names are text, and unnamed private fields never render", async () => {
  const data = fixture();
  data.cluster.label = '<script>alert("bad")</script>';
  data.entries[0]!.label = '<img src=x onerror="bad()">';
  data.servers[0]!.sampledAt = "2026-11-16T12:00:00Z";
  data.servers[0]!.players = ['Survivor <script>alert("bad")</script>', "& < >"];
  Object.assign(data.servers[0]!, { accountId: "SECRET_ACCOUNT", inventory: "SECRET_INVENTORY", location: "SECRET_COORDINATE" });
  await rendered(async (dir) => {
    const player = await readFile(join(dir, "servers/island/players/index.html"), "utf8");
    expect(player).toContain("Survivor &lt;script&gt;");
    expect(player).not.toContain("<script>alert");
    expect(player).not.toContain("SECRET_");
    const detail = await readFile(join(dir, "items/core/knife/index.html"), "utf8");
    expect(detail).toContain("&lt;img src=x onerror=&quot;bad()&quot;&gt;");
    expect(detail).not.toContain('<img src=x');
  }, data);
});

test("catalogue server references do not imply live players or telemetry", async () => {
  const data = fixture();
  data.servers[0]!.players = ["PRIVATE_UNSAMPLED_NAME"];
  await rendered(async (dir) => {
    const players = await readFile(join(dir, "servers/island/players/index.html"), "utf8");
    expect(players).toContain("Waiting for a server snapshot");
    expect(players).not.toContain("PRIVATE_UNSAMPLED_NAME");
    const stats = await readFile(join(dir, "servers/island/stats/index.html"), "utf8");
    expect(stats).toContain("No telemetry published");
    expect(stats).not.toContain("Characters at capture");
    const settings = await readFile(join(dir, "servers/island/settings/index.html"), "utf8");
    expect(settings).toContain("Catalogue defaults");
  }, data);
});

test("large audio libraries paginate static owner pages and do not preload audio", async () => {
  const data = fixture();
  data.sounds = Array.from({ length: 61 }, (_, i) => sound(i + 1));
  await rendered(async (dir) => {
    expect(await readFile(join(dir, "sounds/index.html"), "utf8")).not.toContain("<audio");
    const first = await readFile(join(dir, "sounds/core/knife/index.html"), "utf8");
    const second = await readFile(join(dir, "sounds/core/knife/page/2/index.html"), "utf8");
    expect([...first.matchAll(/<audio/g)]).toHaveLength(60);
    expect([...second.matchAll(/<audio/g)]).toHaveLength(1);
    expect(first).toContain('href="/sounds/core/knife/page/2/"');
    expect(first).not.toContain('preload="auto"');
    expect(first).not.toMatch(/\sautoplay(?:\s|>)/);
    expect([...first.matchAll(/preload="none"/g)]).toHaveLength(60);
  }, data);
});

test("model activation uses a data URL and shows the real animation names without loading a game", async () => {
  const data = fixture();
  data.models[knife.id] = { id: knife.id, label: knife.label, url: "/media/knife.json", bytes: 123456, poster: "/media/knife.png", images: [{ src: "/media/knife.png", label: "Side" }], clips: [{ id: "core:knife/use", label: "Use", seconds: 1, loop: false }] };
  await rendered(async (dir) => {
    const html = await readFile(join(dir, "items/core/knife/index.html"), "utf8");
    expect(html).toContain('data-model-url="/media/knife.json"');
    expect(html).toContain('data-preview-clip="core:knife/use"');
    expect(html).toContain('class="model-live" hidden');
    expect(html).not.toContain("/ws");
    expect(html).not.toContain("iframe");
    expect(html).not.toContain('src="/media/knife.json"');
  }, data);
});

test("guide paths and asset URLs reject traversal and executable sources", () => {
  for (const id of ["../secret", "core:../secret", "core:%2e%2e", "core:x\\y", "core:"]) expect(() => routeId(id)).toThrow();
  for (const url of ["javascript:alert(1)", "//elsewhere/model", "/../private", "/x\\private", "/%2e%2e/private", "/%2felsewhere/model", "/x%5cprivate"]) expect(() => localUrl(url)).toThrow();
  expect(routeId("core:stone-wall/left")).toBe("core/stone-wall/left");
  expect(localUrl('/media/image.png?label="x"')).toBe("/media/image.png?label=&quot;x&quot;");
});

test("search matches every folded term and map navigation stays bounded", () => {
  expect(matchesGuideQuery("Métal hatchet / weapon", searchTerms(" metal   HATCHET "))).toBe(true);
  expect(matchesGuideQuery("Metal pick", searchTerms("metal hatchet"))).toBe(false);
  expect(mapTransform(10, 9999, -9999, 200, 100)).toEqual({ zoom: 5, x: 400, y: -200 });
  expect(mapTransform(1, 20, -20, 200, 100)).toEqual({ zoom: 1, x: 0, y: 0 });
  expect(mapTransform(NaN, Infinity, NaN, 200, 100)).toEqual({ zoom: 1, x: 0, y: 0 });
});
