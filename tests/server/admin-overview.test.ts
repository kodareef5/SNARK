import { expect, test } from "bun:test";
import { ClusterAdmin, basicAuth, preview, signedInText, type ClusterSiteWorld } from "../../client/core/admin/cluster.ts";
import { ADMIN_TERRAIN_SIDE, type AdminChatLine } from "../../shared/admin.ts";
import { TEXT_GLOBAL, TEXT_TRIBE } from "../../shared/net/protocol.ts";
import { idOf } from "../../shared/ids.ts";
import { RANK_CLUSTER, RANK_MAP } from "../../shared/ranks.ts";
import { partsOf, writeMap } from "../../shared/world/mapfile.ts";
import { cornerMap } from "../fixtures/map.ts";

const origin = "https://snark.example";
const world: ClusterSiteWorld = { id: 7, name: "Miami PvE", map: "Miami", mapId: "core:miami", address: "/miami/", players: 2, max: 40 };
const tampa: ClusterSiteWorld = { ...world, id: 8, name: "Tampa PvE", address: "/tampa/", map: "Tampa", mapId: "core:tampa" };
const remote: ClusterSiteWorld = { ...world, id: 9, name: "Island", address: "https://island.example/play/" };
const link = origin + "/admin/worlds/7/map/";
const tampaLink = origin + "/admin/worlds/8/map/";
const auth = "Basic test";
const resolve = (row: ClusterSiteWorld) => row.address === remote.address
  ? { link: "https://island.example/play/admin/", api: null, publicBase: null }
  : { link: row.id === tampa.id ? tampaLink : link, api: `${origin}${row.address}admin/`, publicBase: `${origin}${row.address}` };

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
    if (path.endsWith("/admin/bases.bin?level=3") || path.endsWith("/admin/me.json")) return new Response(null, { status: 404 });
    if (path.endsWith("/map.json")) return Response.json({ head: `map/${head.name}` });
    if (path === headPath) return new Response(head.bytes);
    throw Error(`Unexpected URL ${path}`);
  }, resolve, "overview");
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
    ["/worlds.json", undefined], [`${origin}/miami/admin/overview.json`, undefined], [`${origin}/miami/map.json`, undefined], [headPath, undefined],
  ]);
  calls.length = 0;
  await dashboard.refresh();
  expect(calls).toEqual([["/worlds.json", undefined]]);
  calls.length = 0;
  await dashboard.signIn(link, approved);
  expect(preview(card)?.ground).toBe(pixels);
  expect(preview(card)?.points).toEqual([{ name: "Marta", x: ADMIN_TERRAIN_SIDE / 2, y: ADMIN_TERRAIN_SIDE / 2 }]);
  expect(card.health?.word).toBe("Healthy");
  expect(calls).toEqual([
    [`${origin}/miami/admin/overview.json`, approved], [`${origin}/miami/admin/bases.bin?level=3`, approved], [`${origin}/miami/admin/me.json`, approved],
  ]);
  dashboard.signOut();
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
    if (path === "/worlds.json") return Response.json([world, remote]);
    return authorization === auth ? Response.json(channels) : new Response(null, { status: 401 });
  }, resolve, "chat");
  await dashboard.refresh();
  calls.length = 0;
  await dashboard.signIn(link, auth);
  await dashboard.signIn("https://island.example/play/admin/", auth);
  expect(dashboard.chat("", "").lines.map((line) => line.speaker)).toEqual(["Palmer", "Marta"]);
  expect(dashboard.chat(link, String(TEXT_GLOBAL)).lines.map((line) => line.text)).toEqual(["Outside the gate"]);
  expect(dashboard.chat("https://island.example/play/admin/", "").lines).toEqual([]);
  expect(calls).toEqual([[`${origin}/miami/admin/chat.json`, auth], [`${origin}/miami/admin/me.json`, auth]]);
});

test("signing out clears chat and ignores a pending private reply", async () => {
  const privateReply = Promise.withResolvers<Response>();
  const requested = Promise.withResolvers<void>();
  let delayReply = false;
  const dashboard = new ClusterAdmin(async (path, authorization) => {
    if (path === "/worlds.json") return Response.json([world]);
    if (delayReply && authorization === auth) {
      requested.resolve();
      return privateReply.promise;
    }
    return authorization === auth ? Response.json([{ at: 12, speaker: "Marta", text: "Old", channel: TEXT_GLOBAL }]) : new Response(null, { status: 401 });
  }, resolve, "chat");
  await dashboard.refresh();
  await dashboard.signIn(link, auth);
  expect(dashboard.chat("", "").lines.length).toBe(1);
  delayReply = true;
  const pending = dashboard.refresh();
  await requested.promise;
  dashboard.signOut();
  expect(dashboard.chat("", "").lines).toEqual([]);
  await dashboard.refresh();
  privateReply.resolve(Response.json([{ at: 13, speaker: "Marta", text: "New", channel: TEXT_TRIBE }]));
  expect(await pending).toBe(false);
  expect(dashboard.chat("", "").lines).toEqual([]);
  expect(dashboard.totals().locked).toBe(1);
});


test("two worlds keep separate sign-ins and polling skips rejected passwords", async () => {
  const tampaAuth = "Basic tampa";
  const wrong = "Basic wrong";
  const seen: [string, string | undefined][] = [];
  const dashboard = new ClusterAdmin(async (path, authorization) => {
    if (path === "/worlds.json") return Response.json([world, tampa]);
    seen.push([path, authorization]);
    const miami = path === `${origin}/miami/admin/chat.json`;
    if (authorization !== (miami ? auth : tampaAuth)) return new Response(null, { status: 401 });
    return Response.json([{ at: miami ? 1 : 2, speaker: miami ? "Marta" : "Sam", text: "At the marina", channel: TEXT_GLOBAL }]);
  }, resolve, "chat");
  const miamiChat = `${origin}/miami/admin/chat.json`;
  const tampaChat = `${origin}/tampa/admin/chat.json`;
  await dashboard.refresh();
  expect(dashboard.totals().locked).toBe(2);
  seen.length = 0;
  await dashboard.signIn(link, auth);
  expect(seen).toEqual([[miamiChat, auth], [`${origin}/miami/admin/me.json`, auth]]);
  expect(dashboard.signedIn).toBe(true);
  seen.length = 0;
  await dashboard.signIn(tampaLink, wrong);
  expect(seen).toEqual([[tampaChat, wrong]]);
  expect(dashboard.worlds.get(tampaLink)?.cover).toBe("The password was rejected.");
  expect(dashboard.chat(link, "").lines).toHaveLength(1);
  seen.length = 0;
  await dashboard.refresh();
  expect(seen).toEqual([[miamiChat, auth]]);
  seen.length = 0;
  await dashboard.signIn(tampaLink, tampaAuth);
  expect(seen).toEqual([[tampaChat, tampaAuth], [`${origin}/tampa/admin/me.json`, tampaAuth]]);
  expect(dashboard.totals().locked).toBe(0);
  expect(dashboard.chat("", "").lines.map((line) => line.world)).toEqual([tampa.name, world.name]);
  seen.length = 0;
  await dashboard.refresh();
  expect(seen).toEqual([[miamiChat, auth], [tampaChat, tampaAuth]]);
  dashboard.signOut();
  expect(dashboard.signedIn).toBe(false);
  expect(dashboard.chat("", "").lines).toEqual([]);
  seen.length = 0;
  await dashboard.refresh();
  expect(seen).toEqual([[miamiChat, undefined], [tampaChat, undefined]]);
});

const keys: Record<string, number> = { "/miami/": 7, "/tampa/": 8, "/naples/": 10 };
const naples: ClusterSiteWorld = { ...world, id: 10, name: "Naples PvE", address: "/naples/", map: "Naples", mapId: "core:naples" };
const naplesLink = origin + "/admin/worlds/10/map/";
const three = (row: ClusterSiteWorld) => ({ link: [link, tampaLink, naplesLink][[7, 8, 10].indexOf(row.id as number)]!, api: `${origin}${row.address}admin/`, publicBase: null });
const decoded = (auth: string | undefined): string => (auth ? atob(auth.slice("Basic ".length)) : "");

/** Three worlds that take `accepts[world]` as passwords, each answering me.json with the rank the password gives there. */
function cluster(accepts: Record<number, Record<string, number>>) {
  const seen: [string, string][] = [];
  const dashboard = new ClusterAdmin(async (path, authorization) => {
    if (path === "/worlds.json") return Response.json([world, tampa, naples]);
    const at = Object.keys(keys).find((k) => path.startsWith(origin + k))!;
    seen.push([path.slice(origin.length), decoded(authorization)]);
    const rank = accepts[keys[at]!]?.[decoded(authorization).slice(decoded(authorization).indexOf(":") + 1)];
    if (rank === undefined) return new Response(null, { status: 401 });
    if (path.endsWith("/me.json")) return Response.json({ name: decoded(authorization).split(":")[0], id: "", rank, world: keys[at] });
    return Response.json([]);
  }, three, "chat");
  return { seen, dashboard };
}

test("a cluster sign-in is offered to the other worlds and a map's is not", async () => {
  const both = { "cluster-pw": RANK_CLUSTER, "map-pw": RANK_MAP };
  const { seen, dashboard } = cluster({ 7: both, 8: both, 10: both });
  await dashboard.refresh();
  seen.length = 0;
  await dashboard.signIn(link, basicAuth("", "map-pw"));
  expect(seen.map(([path]) => path)).toEqual(["/miami/admin/chat.json", "/miami/admin/me.json"]);
  expect(dashboard.totals().locked).toBe(2);
  expect(signedInText(dashboard.signedInAs)).toBe("Signed in as admin, at the map rank.");
  seen.length = 0;
  await dashboard.signIn(tampaLink, basicAuth("", "cluster-pw"));
  expect(seen.map(([path]) => path)).toEqual(["/tampa/admin/chat.json", "/tampa/admin/me.json", "/naples/admin/chat.json"]);
  expect(dashboard.totals().locked).toBe(0);
  expect(signedInText(dashboard.signedInAs)).toBe("Signed in as admin, at the cluster rank.");
});

test("the typed name is sent with the password, and admin when none is typed", async () => {
  const { seen, dashboard } = cluster({ 7: { secret: RANK_MAP } });
  await dashboard.refresh();
  seen.length = 0;
  await dashboard.signIn(link, basicAuth("  kody ", "secret"));
  expect(seen).toEqual([["/miami/admin/chat.json", "kody:secret"], ["/miami/admin/me.json", "kody:secret"]]);
  expect(decoded(basicAuth("", "pässword"))).toBe(String.fromCharCode(...new TextEncoder().encode("admin:pässword")));
  expect(signedInText({ name: "Mara", id: idOf(1, 1), rank: RANK_MAP, world: 7 })).toBe(`Signed in as Mara (${idOf(1, 1)}), at the map rank.`);
});

test("a world that refuses a cluster sign-in stays locked and the others open", async () => {
  const { dashboard } = cluster({ 7: { "cluster-pw": RANK_CLUSTER }, 8: {}, 10: { "cluster-pw": RANK_CLUSTER } });
  await dashboard.refresh();
  await dashboard.signIn(link, basicAuth("kody", "cluster-pw"));
  expect([dashboard.worlds.get(link)!.locked, dashboard.worlds.get(tampaLink)!.locked, dashboard.worlds.get(naplesLink)!.locked]).toEqual([false, true, false]);
  expect(dashboard.worlds.get(tampaLink)!.cover).toBe("Sign in to read this world's chat.");
  expect(dashboard.authenticating).toBe(false);
});
