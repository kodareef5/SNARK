import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { shown, writeSourceRoot } from "../../tools/source.ts";

test("the code as shown is tracked text outside the art and the planning documents, and what the tests read", () => {
  const yes = ["server/main.ts", "README.md", "LICENSE", ".gitignore", "config/dev/Game.ini", "deploy/windows/cluster.ps1", "tests/fixtures/art/raptor.snpk", "tools/blender/example/demo/creatures/pup/tex/hide_base.png"];
  const no = ["assets/source/core/creatures/dodo/dodo.snpk", "assets/source/sound-requests.md", "planning/decisions.md", "planning/art-trial/wood/wood_base.png", "planning/reference/device-reports/a.json", "tools/sound/take.wav", "client/favicon.png"];
  expect(yes.filter((f) => !shown(f))).toEqual([]);
  expect(no.filter(shown)).toEqual([]);
});

test("the source front page links into the game and root commands forward their arguments", () => {
  const out = mkdtempSync(join(tmpdir(), "snark-source-"));
  try {
    const game = join(out, "game");
    mkdirSync(game);
    for (const file of ["LICENSE", ".gitignore"]) writeFileSync(join(game, file), "fixture");
    writeFileSync(join(game, "README.md"), "[Agent](agent/README.md#run-it) [Here](#run) [Web](https://example.org/)\n");
    writeFileSync(join(game, "package.json"), JSON.stringify({ scripts: { echo: "bun echo.ts" } }));
    writeFileSync(join(game, "echo.ts"), "console.log(JSON.stringify(process.argv.slice(2)))");
    writeFileSync(join(game, "bunfig.toml"), '[test]\nroot = "tests"\npreload = ["./tests/setup.ts"]\n');
    writeSourceRoot(out);
    expect(readdirSync(out).sort()).toEqual([".gitignore", "LICENSE", "README.md", "bunfig.toml", "game", "package.json"]);
    expect(readFileSync(join(out, "README.md"), "utf8")).toBe("[Agent](game/agent/README.md#run-it) [Here](#run) [Web](https://example.org/)\n");
    expect(Bun.TOML.parse(readFileSync(join(out, "bunfig.toml"), "utf8"))).toEqual({ test: { root: "game/tests", preload: ["./game/tests/setup.ts"] } });
    const result = Bun.spawnSync([process.execPath, "run", "echo", "--", "two words"], { cwd: out });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout.toString())).toEqual(["two words"]);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
