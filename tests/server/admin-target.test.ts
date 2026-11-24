import { expect, test } from "bun:test";
import { resolveAdmin, type AdminWorld } from "../../client/admin/target.ts";

const origin = "https://snark.example";
const miami: AdminWorld = { id: 14, name: "Miami", map: "Miami", mapId: "core:miami", address: "/miami/", players: 2, max: 70 };
const tampa: AdminWorld = { ...miami, id: 18, name: "Tampa", address: "/west/tampa" };
const worlds = [miami, tampa];

test("world links and reads follow the selected ID through a mounted gateway", () => {
  const ctx = resolveAdmin(origin + "/admin/worlds/18/items/?q=axe", worlds);
  expect(ctx.view).toBe("items");
  expect(ctx.world).toEqual(tampa);
  expect(ctx.worldUrl("survivors")).toBe("/admin/worlds/18/survivors/");
  expect(ctx.api("loadouts/save")).toBe(origin + "/west/tampa/admin/loadouts/save");
  expect(ctx.api("../map.json")).toBe(origin + "/west/tampa/map.json");
  expect(() => ctx.api("../../miami/admin/settings")).toThrow();
  expect(() => ctx.api("https://remote.example/admin/")).toThrow();
  expect(resolveAdmin(origin + "/west/tampa/admin/worlds/18/health/", worlds).world).toEqual(tampa);
});

test("a missing or external world cannot fall back to the first server", () => {
  const url = origin + "/admin/worlds/14/settings/";
  expect(() => resolveAdmin(url, [tampa])).toThrow();
  expect(() => resolveAdmin(url, [{ ...miami, address: "https://remote.example/city/" }])).toThrow();
  expect(() => resolveAdmin(url, [{ ...miami, address: "javascript:void(0)" }])).toThrow();
});

test("the cluster and a standalone world keep distinct operator scopes", () => {
  const local: AdminWorld = { ...miami, id: "local", address: "/" };
  const cluster = resolveAdmin(origin + "/admin/chat/", [local]);
  expect(cluster.view).toBe("chat");
  expect(cluster.world).toBeNull();
  expect(() => cluster.api("settings")).toThrow();
  expect(resolveAdmin(origin + "/admin/worlds/local/map/", [local]).api("stats.json")).toBe(origin + "/admin/stats.json");
});
