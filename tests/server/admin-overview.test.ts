import { expect, test } from "bun:test";
import { ClusterAdmin, preview, type ClusterSiteWorld } from "../../client/core/admin/cluster.ts";
import { ADMIN_TERRAIN_SIDE, type AdminChatLine } from "../../shared/admin.ts";
import { TEXT_GLOBAL, TEXT_TRIBE } from "../../shared/net/protocol.ts";
import { partsOf, writeMap } from "../../shared/world/mapfile.ts";
import { cornerMap } from "../fixtures/map.ts";

const origin = "https://snark.example";
const world: ClusterSiteWorld = { id: 7, name: "Miami PvE", map: "Miami", mapId: "core:miami", address: "/miami/", players: 2, max: 40 };
const remote: ClusterSiteWorld = { ...world, id: 8, name: "Island", address: "https://island.example/play/" };
const link = origin + "/admin/worlds/7/map/";
const auth = "Basic test";
const resolve = (row: ClusterSiteWorld) => row.address === remote.address
  ? { link: "https://island.example/play/admin/", api: null, publicBase: null }
  : { link, api: `${origin}/miami/admin/`, publicBase: `${origin}/miami/` };

test("public terrain stays visible when private positions unlock and clear", async () => {
  const head = partsOf(writeMap(cornerMap()))[0]!;
  const headPath = `${origin}/miami/map/${head.name}`;
  const calls: [string, string | undefined][] = [];
  const approved = "Basic approved";
  const land = cornerMap().dims;
  const overview = {
    stats: {
      world: { startedAt: 1 }, map: { sizeX: land.chunksX * 64, sizeZ: land.chunksZ * 64 }, online: { now: 3, max: 40 },
      ticks: { budget: 1000 / 30, rate: 30, seconds: { at: [2], ticks: [30], p50: [4], worst: [12], late: [1], dropped: [0] }, long: { own: 0, core: 0, page: 0 } },
      bodies: { count: 10, max: 200, reserve: 40, refused: 0 },
    },
    positions: [{ name: "Marta", x: land.chunksX * 32, z: land.chunksZ * 32 }],
    chat: [],
  };
  const dashboard = new ClusterAdmin(async (path, authorization) => {
    calls.push([path, authorization]);
    if (path === "/worlds.json") return Response.json([world, remote]);
    if (path.endsWith("/admin/overview.json")) return authorization === approved ? Response.json(overview) : new Response(null, { status: 401 });
    if (path.endsWith("/admin/bases.bin?level=3")) return new Response(null, { status: 404 });
    if (path.endsWith("/map.json")) return Response.json({ head: `map/${head.name}` });
    if (path === headPath) return new Response(head.bytes);
    throw Error(`Unexpected URL ${path}`);
  }, resolve, "overview");
  dashboard.signIn(auth);
  await dashboard.refresh();
  const card = dashboard.worlds.get(link)!;
  const map = preview(card)!;
  expect(card.status).toBe("Locked");
  expect(map.ground?.length).toBe(ADMIN_TERRAIN_SIDE ** 2 * 4);
  const pixels = map.ground!;
  expect(pixels.some((red, i) => i % 4 === 0 && red - pixels[i + 2]! > 10)).toBe(true);
  expect(pixels.some((red, i) => i % 4 === 0 && pixels[i + 2]! - red > 20)).toBe(true);
  expect(map.points).toEqual([]);
  expect(map.bases).toEqual([]);
  expect(dashboard.totals()).toEqual({ players: 4, max: 80, locked: 1 });
  expect(calls).toEqual([
    ["/worlds.json", undefined], [`${origin}/miami/admin/overview.json`, auth], [`${origin}/miami/map.json`, undefined], [headPath, undefined],
  ]);
  calls.length = 0;
  await dashboard.refresh();
  expect(calls).toEqual([["/worlds.json", undefined]]);
  calls.length = 0;
  dashboard.signIn(approved);
  await dashboard.refresh();
  expect(preview(card)?.ground).toBe(pixels);
  expect(preview(card)?.points).toEqual([{ name: "Marta", x: ADMIN_TERRAIN_SIDE / 2, y: ADMIN_TERRAIN_SIDE / 2 }]);
  expect(card.health?.word).toBe("Healthy");
  expect(calls).toEqual([["/worlds.json", undefined], [`${origin}/miami/admin/overview.json`, approved], [`${origin}/miami/admin/bases.bin?level=3`, approved]]);
  dashboard.signIn("");
  expect(preview(card)?.ground).toBe(pixels);
  expect(preview(card)?.points).toEqual([]);
});

test("chat reads only chat and keeps credentials on the cluster origin", async () => {
  const channels: AdminChatLine[] = [
    { at: 1, speaker: "Marta", text: "Outside the gate", channel: TEXT_GLOBAL },
    { at: 2, speaker: "Palmer", text: "At base", channel: TEXT_TRIBE },
  ];
  const calls: [string, string | undefined][] = [];
  const dashboard = new ClusterAdmin(async (path, authorization) => {
    calls.push([path, authorization]);
    return Response.json(path === "/worlds.json" ? [world, remote] : channels);
  }, resolve, "chat");
  dashboard.signIn(auth);
  await dashboard.refresh();
  expect(dashboard.chat("", "").lines.map((line) => line.speaker)).toEqual(["Palmer", "Marta"]);
  expect(dashboard.chat(link, String(TEXT_GLOBAL)).lines.map((line) => line.text)).toEqual(["Outside the gate"]);
  expect(dashboard.chat("https://island.example/play/admin/", "").lines).toEqual([]);
  expect(calls).toEqual([["/worlds.json", undefined], [`${origin}/miami/admin/chat.json`, auth]]);
});

test("signing out clears chat and ignores a pending private reply", async () => {
  const privateReply = Promise.withResolvers<Response>();
  const requested = Promise.withResolvers<void>();
  let calls = 0;
  const dashboard = new ClusterAdmin(async (path, authorization) => {
    if (path === "/worlds.json") return Response.json([world]);
    calls++;
    if (calls === 2) {
      requested.resolve();
      return privateReply.promise;
    }
    return authorization === auth ? Response.json([{ at: 12, speaker: "Marta", text: "Old", channel: TEXT_GLOBAL }]) : new Response(null, { status: 401 });
  }, resolve, "chat");
  dashboard.signIn(auth);
  await dashboard.refresh();
  expect(dashboard.chat("", "").lines.length).toBe(1);
  const pending = dashboard.refresh();
  await requested.promise;
  dashboard.signIn("");
  expect(dashboard.chat("", "").lines).toEqual([]);
  await dashboard.refresh();
  privateReply.resolve(Response.json([{ at: 13, speaker: "Marta", text: "New", channel: TEXT_TRIBE }]));
  expect(await pending).toBe(false);
  expect(dashboard.chat("", "").lines).toEqual([]);
  expect(dashboard.totals().locked).toBe(1);
});
