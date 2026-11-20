import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import grunt from "../../grunt/extension.ts";
import type { NotifyType, PiCommand } from "../../grunt/pi.ts";
import { GRUNT_VERSION } from "../../grunt/protocol.ts";

const ROOT = join(import.meta.dir, "../..");

/** The extension against a stand-in for Pi: the commands it registers, and what each tells the user. */
function load() {
  const commands = new Map<string, PiCommand>();
  grunt({ registerCommand: (name, command) => void commands.set(name, command) });
  const run = async (name: string, args: string) => {
    const told: [string, NotifyType | undefined][] = [];
    await commands.get(name)!.handler(args, { ui: { notify: (message, type) => void told.push([message, type]) } });
    return told;
  };
  return { commands, run };
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
  const status = await run("grunt", "");
  expect(status).toEqual([[expect.stringContaining(`protocol ${GRUNT_VERSION} (draft)`), "info"]]);
  expect(await run("grunt", "status")).toEqual(status);
  const [[where, kind]] = await run("grunt", "  protocol  ");
  expect(kind).toBe("info");
  expect(where).toEndWith(join("grunt", "protocol.md"));
  expect(await run("grunt", "dance")).toEqual([[expect.stringContaining('unknown subcommand "dance"'), "warning"]]);
});
