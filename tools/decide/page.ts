// The Decider page alone, served from a development world where movers are in trouble: raptors sent back and forth
// across the closed end of a U of walls, and a herd shut in a pen with one of them sent out through it.
// --drive works the page in Chrome as an admin would, pictures each state into var/decide/page/shots/, and fails on
// any fault. The lab's part of the page shows the scoreboard of this checkout's .cache/decide, where there is one.
//
//   bun tools/decide/page.ts [--port 8793] [--drive]

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { GOAL_WALK } from "../../server/behavior.ts";
import type { Host } from "../../server/host.ts";
import { loadModules, startServer } from "../../server/main.ts";
import { rowOf } from "../../server/settings/catalog.ts";
import { Rules } from "../../server/settings/rules.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { wallX, wallZ } from "../../tests/fixtures/decide-scenes.ts";
import { flatMap } from "../../tests/fixtures/map.ts";
import { corePackBytes } from "../../tests/fixtures/pack.ts";
import { buildAdmin } from "../build-admin.ts";
import { findChrome } from "../chrome.ts";
import { browse, type Page } from "../loadout/drive.ts";
import { splitPack } from "../pack/split.ts";

const ROOT = resolve(import.meta.dir, "../..");
/** The U: its middle, its closed end, how wide and how deep. */
const U = { x: 256, north: 300, wide: 54, deep: 66 };
/** The pen: a closed square, and how many stand in it. */
const PEN = { x0: 120, z0: 120, x1: 144, z1: 144, herd: 14 };

/** Puts the walls and the movers into `host`, and keeps the movers at it: each is sent across the wall again on arriving. */
function trouble(host: Host): { stop: () => void } {
  const w = { host, world: host.world, tick: () => {} };
  const mind = host.creatures.mind, dims = host.world.dims;
  // Every chunk is held awake, as if a player stood in each: no client is in this world.
  for (let chunk = 0; chunk < dims.chunksX * dims.chunksZ; chunk++) host.creatures.watch(chunk, 1);
  wallX(w, U.x - U.wide / 2, U.x + U.wide / 2, U.north);
  wallZ(w, U.x - U.wide / 2, U.north - U.deep, U.north);
  wallZ(w, U.x + U.wide / 2, U.north - U.deep, U.north);
  const sides = [{ x: U.x, z: U.north - 4 }, { x: U.x, z: U.north + 8 }];
  const runners = [-12, 0, 12].map((dx, i) => ({ e: host.spawnCreature(i === 1 ? "core:parasaur" : "core:raptor", U.x + dx, U.north - 4, 1), dx, at: 1 }));
  for (const r of runners) mind.goTo(r.e, sides[1]!.x + r.dx, sides[1]!.z, GOAL_WALK);
  // The pen has a gap one piece wide in its south wall, and the one sent out starts at the far side of the herd.
  wallX(w, PEN.x0, PEN.x1, PEN.z1);
  wallZ(w, PEN.x0, PEN.z0, PEN.z1);
  wallZ(w, PEN.x1, PEN.z0, PEN.z1);
  wallX(w, PEN.x0, (PEN.x0 + PEN.x1) / 2 - 1.5, PEN.z0);
  wallX(w, (PEN.x0 + PEN.x1) / 2 + 1.5, PEN.x1, PEN.z0);
  for (let n = 0; n < PEN.herd; n++) host.spawnCreature("core:dodo", PEN.x0 + 4 + (n % 5) * 4, PEN.z0 + 3 + Math.floor(n / 5) * 4, 1);
  const out = host.spawnCreature("core:raptor", (PEN.x0 + PEN.x1) / 2, PEN.z1 - 3, 1);
  const ends = [{ x: (PEN.x0 + PEN.x1) / 2, z: PEN.z0 - 14 }, { x: (PEN.x0 + PEN.x1) / 2, z: PEN.z1 - 3 }];
  let end = 0;
  mind.goTo(out, ends[0]!.x, ends[0]!.z, GOAL_WALK);
  const again = setInterval(() => {
    for (const r of runners) {
      if (!mind.arrived(r.e)) continue;
      r.at = 1 - r.at;
      mind.goTo(r.e, sides[r.at]!.x + r.dx, sides[r.at]!.z, GOAL_WALK);
    }
    if (mind.arrived(out)) mind.goTo(out, ends[(end = 1 - end)]!.x, ends[end]!.z, GOAL_WALK);
  }, 500);
  return { stop: () => clearInterval(again) };
}

const q = (selector: string): string => `document.querySelector(${JSON.stringify(selector)})`;

/** Works the page as an admin would, each act judged by what the server then holds; pictures go to `out`. */
async function drive(page: Page, host: Host, out: string, lab: boolean): Promise<string[]> {
  const faults: string[] = [];
  const check = (ok: boolean, what: string): void => void (ok || faults.push(what));
  const policy = (): string => host.rules.text("DecidePolicy");
  const said = async (words: string): Promise<boolean> => page.wait(`${q("#msg")}?.textContent === ${JSON.stringify(words)}`);
  check(await page.wait(`document.querySelectorAll("#points select").length > 3 && document.querySelectorAll("#tiles .tile").length > 0`), "the page draws its points and its tiles");
  check((await page.run(`document.querySelectorAll("#recent .answer").length`)) === 0, "with every point off nothing is answered");
  await page.shot(join(out, "off.png"));

  // Every point handed to the rule at once, from the page.
  await page.choose('select[data-point="*"]', "rule");
  check(await said("Done."), `the page says the policy was set (it says "${await page.run(`${q("#msg")}?.textContent`)}")`);
  check(/\*=rule/.test(policy()), `the world's DecidePolicy holds the rule for every point (${policy()})`);
  // The select chosen from keeps the focus, and the table is still drawn again round it.
  const row = `[...document.querySelectorAll("#points tbody tr")].find((r) => r.firstElementChild?.textContent === "nav.ring")`;
  check(await page.wait(`${row}?.children[2]?.textContent === "rule"`, 50), "the table shows the rule at each point while the select is still in hand");
  check(await page.wait(`Number(${row}?.children[3]?.textContent) > 0`, 600), "and its counts go on rising");
  check((await page.run(`document.activeElement?.dataset?.point`)) === "*", "the select chosen from is still in hand");
  check((await page.run(`[...document.querySelectorAll("#recent table")].every((t) => t.tBodies[0].rows.length > 0)`)) === true, "no table of the recent answers is empty");
  check(await page.wait(`document.querySelectorAll("#recent .answer").length > 0`, 600), "within a minute the movers in trouble are answered, and the page shows it");
  check(await page.wait(`!!document.querySelector("#map svg circle, #map svg path")`, 100), "where they were is drawn");
  check(await page.wait(`[...document.querySelectorAll("#recent .answer")].some((a) => a.textContent.includes("nav.ring"))`, 900), "a ring is asked and shown with its headings");
  await page.shot(join(out, "rule.png"));

  // One point set apart, then given back to follow the rest.
  await page.choose('select[data-point="nav.do"]', "watch");
  check(await said("Done."), "one point's policy is set");
  check(/nav\.do=watch/.test(policy()), `nav.do is watched and the rest keep the rule (${policy()})`);
  await page.choose('select[data-point="nav.do"]', "");
  check(await page.wait("true", 10) && (await said("Done.")) && !/nav\.do/.test(policy()), `nav.do follows the rest again (${policy()})`);

  // Weights read again; this world is in no cluster, so there is nowhere to copy to.
  await page.press("#reload");
  check(await said("Done."), "the weights are read again");
  check((await page.run(`${q("#clone")}?.disabled === true && ${q("#clone")}?.title`)) === "This world is in no cluster.", "the copy button is off and says why");
  if (lab) {
    check(await page.wait(`${q("#lab")}?.textContent?.includes("Whole episodes on layouts held out")`, 100), "the lab's part leads with whole episodes");
    check((await page.run(`${q("#lab")}?.textContent?.includes("NaN")`)) === false, "no number of the lab's part reads NaN");
  }
  await page.shot(join(out, "lab.png"));

  // Off again: the answers stop, and what the page kept is let go.
  await page.choose('select[data-point="*"]', "off");
  check((await said("Done.")) && /\*=off/.test(policy()), `every point is off again (${policy()})`);
  for (const e of page.errors) faults.push(`the page raised: ${e}`);
  return faults;
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { port: { type: "string", default: "8793" }, drive: { type: "boolean" } } });
  const dist = join(ROOT, "var/decide/page");
  mkdirSync(join(dist, "admin"), { recursive: true });
  mkdirSync(join(dist, "assets"), { recursive: true });
  mkdirSync(join(dist, "shots"), { recursive: true });
  // A built client as far as a world needs one to start: the manifest and the files it names, without the meshes.
  const { files, manifest } = splitPack(corePackBytes(), "core");
  for (const [f, file] of files.entries()) if (file.role !== "mesh") writeFileSync(join(dist, "assets", manifest.files[f]!.name), file.bytes);
  writeFileSync(join(dist, "assets/manifest.json"), JSON.stringify(manifest));
  await buildAdmin(dist);
  const map = join(dist, "flat.snmap");
  writeFileSync(map, writeMap(flatMap(8)));
  const config = new Rules();
  const refused = config.set(rowOf("NoDinos", true)!, "True", "command line");
  if (refused !== "") throw new Error(refused);
  const kept = mkdtempSync(join(ROOT, "var/decide/world-"));
  const server = startServer({ port: Number(values.port), clientDir: dist, dev: true, config, map, modules: await loadModules([], ""), dbPath: join(kept, "world.db"), noBackups: true });
  const scene = trouble(server.host);
  const at = `http://127.0.0.1:${server.port}/admin/worlds/local/decide/`;
  console.log(`the Decider page: ${at}`);
  if (values.drive) {
    const chrome = findChrome();
    if (!chrome) throw new Error("no Chrome to work the page in");
    let faults: string[];
    try {
      const lab = await Bun.file(join(ROOT, ".cache/decide/scoreboard.json")).exists();
      faults = await browse(chrome, at, kept, (page) => drive(page, server.host, join(dist, "shots"), lab));
    } finally {
      scene.stop();
      server.stop();
      rmSync(kept, { recursive: true, force: true });
    }
    console.log(faults.length === 0 ? `the page did all that was asked of it; pictures in ${join(dist, "shots")}` : `${faults.length} things went wrong:\n${faults.map((f) => `  ${f}`).join("\n")}`);
    process.exit(faults.length === 0 ? 0 : 1);
  }
}
