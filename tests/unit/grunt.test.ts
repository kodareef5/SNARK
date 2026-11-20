import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import grunt from "../../grunt/extension.ts";
import type { NotifyType, PiCommand, PiExtensionAPI, PiTool } from "../../grunt/pi.ts";
import { GRUNT_VERSION } from "../../grunt/protocol.ts";
import { SKILLS } from "../../grunt/skills.ts";

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
  expect([...tools.keys()]).toEqual(["game_connect", "game_look", "game_skills", "game_do", "game_tasks", "game_stop", "game_say", "game_goal"]);
  for (const t of tools.values()) expect(t.parameters).toMatchObject({ type: "object", additionalProperties: false });
  expect((tools.get("game_do")!.parameters.properties as { skill: { enum: string[] } }).skill.enum).toEqual(Object.keys(SKILLS));
  const skills = JSON.parse((await tools.get("game_skills")!.execute("1", {}, undefined, undefined, {})).content[0]!.text);
  expect(skills.map((s: { skill: string }) => s.skill)).toContain("harvest");
  expect(tools.get("game_look")!.execute("2", {}, undefined, undefined, {})).rejects.toThrow("not connected");
});
