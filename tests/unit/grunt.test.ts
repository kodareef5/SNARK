import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import grunt from "../../grunt/extension.ts";
import type { NotifyType, PiCommand, PiExtensionAPI, PiTool } from "../../grunt/pi.ts";
import { GRUNT_VERSION } from "../../grunt/protocol.ts";
import { SKILLS } from "../../grunt/skills.ts";
import { NavMap, WALK } from "../../grunt/nav.ts";
import { BLUEPRINTS } from "../../grunt/blueprints.ts";
import { compile } from "../../grunt/layout.ts";

const ROOT = join(import.meta.dir, "../..");

/** The extension against a stand-in for Pi: the commands and tools it registers, and what each tells the user. */
function load() {
  const commands = new Map<string, PiCommand>();
  const tools = new Map<string, PiTool>();
  let active: string[] = ["read", "bash"];
  const pi: PiExtensionAPI = {
    registerCommand: (name, command) => void commands.set(name, command),
    registerTool: (tool) => void (tools.set(tool.name, tool), active.push(tool.name)),
    sendMessage: () => {},
    getActiveTools: () => [...active],
    setActiveTools: (names) => void (active = names),
    on: () => undefined,
  };
  grunt(pi);
  const run = async (name: string, args: string) => {
    const told: [string, NotifyType | undefined][] = [];
    await commands.get(name)!.handler(args, { ui: { notify: (message, type) => void told.push([message, type]) } });
    return told;
  };
  return { commands, tools, run };
}

test("the repository is a Pi package whose one extension is grunt's", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  expect(pkg.keywords).toContain("pi-package");
  expect(pkg.pi).toEqual({ extensions: ["./grunt/extension.ts"] });
  // Pi supplies its own packages to an extension; a copy in the manifest would shadow them, and the repository takes none.
  expect(pkg.dependencies ?? {}).toEqual({});
  expect(pkg.peerDependencies ?? {}).toEqual({});
});

test("grunt registers /grunt, which answers status, protocol and an unknown subcommand", async () => {
  const { commands, run } = load();
  expect([...commands.keys()]).toEqual(["grunt"]);
  const [[status, kind]] = await run("grunt", "");
  expect(kind).toBe("info");
  expect(status).toContain(`protocol ${GRUNT_VERSION} (draft). Not connected`);
  expect(await run("grunt", "status")).toEqual([[status, "info"]]);
  const [[where]] = await run("grunt", "  protocol  ");
  expect(where).toEndWith(join("grunt", "protocol.md"));
  expect(await run("grunt", "connect")).toEqual([[expect.stringContaining("usage: /grunt connect"), "warning"]]);
  expect(await run("grunt", "dance")).toEqual([[expect.stringContaining('unknown subcommand "dance"'), "warning"]]);
});

test("the Director's tools are the game_ ones, with plain JSON Schema parameters, and refuse to act unconnected", async () => {
  const { tools } = load();
  expect([...tools.keys()]).toEqual(["game_connect", "game_look", "game_skills", "game_do", "game_tasks", "game_stop", "game_say", "game_blueprints", "game_goal"]);
  for (const t of tools.values()) expect(t.parameters).toMatchObject({ type: "object", additionalProperties: false });
  expect((tools.get("game_do")!.parameters.properties as { skill: { enum: string[] } }).skill.enum).toEqual(Object.keys(SKILLS));
  const skills = JSON.parse((await tools.get("game_skills")!.execute("1", {}, undefined, undefined, {})).content[0]!.text);
  expect(skills.map((s: { skill: string }) => s.skill)).toContain("harvest");
  expect(tools.get("game_look")!.execute("2", {}, undefined, undefined, {})).rejects.toThrow("not connected");
});

test("a cell already impassable when a route was planned is not ground that got worse", () => {
  const nav = new NavMap();
  nav.fromTerrain({ origin: [-20, -20], cell: 2, size: [20, 20], rows: Array.from({ length: 20 }, (_, j) => (j === 10 ? "..........#........." : "....................")), legend: { ".": "ground", "#": "blocked" } } as never);
  const start: [number, number, number] = [1, 0, 1];
  const r = nav.route(start, [1, 0, -15], WALK)!;
  const snap = nav.snapshot(r.points, start, WALK);
  expect(nav.dearerAhead(snap, start, r.points, WALK)).toBe(false);
  nav.bump(1, -3);
  expect(nav.dearerAhead(nav.snapshot(r.points, start, WALK), start, r.points, WALK)).toBe(false);
});

test("every blueprint in the library lays out without a problem, and the hut is the pieces a hut is", () => {
  for (const [name, l] of Object.entries(BLUEPRINTS)) expect([name, compile(l).problems]).toEqual([name, []]);
  expect(compile(BLUEPRINTS.hut_2x2!).counts).toEqual({ foundation: 4, wall: 7, doorframe: 1, door: 1, ceiling: 4 });
  // Two rooms share one wall, with the door between them on it.
  const long = compile(BLUEPRINTS.longhouse_2x5!);
  expect(long.counts).toMatchObject({ foundation: 10, door: 2, doorframe: 2, windowframe: 2, ceiling: 10 });
  expect(long.counts.wall! + long.counts.doorframe! + long.counts.windowframe!).toBe(16);
  // Stairs leave the ceiling over them open, and the storey above has its floor everywhere else.
  const two = compile(BLUEPRINTS.house_3x3_two_storey!);
  expect(two.pieces.filter((p) => p.form === "ceiling" && p.level === 0).length).toBe(8);
  expect(two.pieces.findIndex((p) => p.form === "stairs")).toBeLessThan(two.pieces.findIndex((p) => p.form === "ceiling"));
  // Floors before walls, walls before the doors in them and the ceilings on them.
  const hut = compile(BLUEPRINTS.hut_2x2!).pieces.map((p) => p.form);
  expect(hut.lastIndexOf("foundation")).toBeLessThan(hut.indexOf("wall"));
  expect(hut.indexOf("doorframe")).toBeLessThan(hut.indexOf("door"));
  expect(hut.lastIndexOf("wall")).toBeLessThan(hut.indexOf("ceiling"));
});

test("a layout's mistakes are told plainly", () => {
  expect(compile({ rooms: [{ at: [0, 0], size: [2, 2], doors: ["s2", "x1"] }] }).problems).toEqual([
    "room 0: \"s2\" is past the end of the room's s side (2 cells: s0 to s1)",
    "room 0: \"x1\" is not a side: n, e, s or w, with the cell along it (s0, s1, ...)",
  ]);
  expect(compile({ rooms: [{ at: [0, 0], size: [2, 2] }], stairs: [{ at: [0, 0], up: "n" }] }).problems).toEqual(["stairs at 0,0 storey 0 lead up to no room"]);
});
