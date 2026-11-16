import { expect, test } from "bun:test";
import { shown } from "../../tools/source.ts";

test("the code as shown is tracked text outside the art, the planning documents, and what the tests read", () => {
  const yes = ["server/main.ts", "README.md", "LICENSE", ".gitignore", "config/dev/Game.ini", "deploy/windows/cluster.ps1", "planning/decisions.md", "planning/reference/device-reports/a.json", "tests/fixtures/art/raptor.snpk", "tools/blender/example/demo/creatures/pup/tex/hide_base.png"];
  const no = ["assets/source/core/creatures/dodo/dodo.snpk", "assets/source/sound-requests.md", "planning/art-trial/wood/wood_base.png", "planning/art-trial/reports/map.transcript.txt", "planning/art-trial/wood/build.py", "tools/sound/take.wav", "client/favicon.png"];
  expect(yes.filter((f) => !shown(f))).toEqual([]);
  expect(no.filter(shown)).toEqual([]);
});
