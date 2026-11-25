// The sound board: an admin's page that the server opens on a development server, and elsewhere only to the admin
// password; and what it lists of every owner's sounds, by occasion, as the game hears each.

import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listSounds, takesOf } from "../../client/core/sound/listing.ts";
import { changedNothing, type AdminGate } from "../../server/admin/gate.ts";
import { Guesses } from "../../server/guesses.ts";
import { SOURCE_DIR, boardOwners, soundBoard, soundFolders } from "../../server/sound-board.ts";
import { artTest } from "../fixtures/needs-art.ts";
import { builtSounds } from "../fixtures/sounds.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry();
const FAMILIES = ["core:surface", "core:body", "core:weapon", "core:ui", "core:world"];

test("a POST to the board only reads, so the log of a page's changes leaves it out", () => {
  const root = mkdtempSync(join(tmpdir(), "snark-board-"));
  try {
    const page = join(root, "sounds.html");
    writeFileSync(page, "<!doctype html><title>board</title>");
    const gate: AdminGate = { dev: false, password: "kiwi", guesses: new Guesses(), tick: () => 0 };
    for (const path of ["/sounds.html", "/admin/sounds.json"]) {
      const req = new Request(`http://localhost${path}`, { method: "POST", headers: { authorization: `Basic ${btoa("admin:kiwi")}` } });
      expect([path, soundBoard(req, "1.2.3.4", gate, page, () => [], root)!.status, changedNothing(req)]).toEqual([path, 200, true]);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the board opens on a development server, and elsewhere only to the admin password, with wrong guesses counted", async () => {
  const root = mkdtempSync(join(tmpdir(), "snark-board-"));
  try {
    const page = join(root, "sounds.html");
    writeFileSync(page, "<!doctype html><title>board</title>");
    mkdirSync(join(root, "src", "core", "creatures", "dodo", "sound"), { recursive: true });
    writeFileSync(join(root, "src", "core", "creatures", "dodo", "sound", "brief.json"), '{"slots":{}}');
    writeFileSync(join(root, "src", "secret.txt"), "no");
    const ask = (gate: AdminGate, path: string, password?: string): Response | null =>
      soundBoard(new Request(`http://localhost${path}`, password === undefined ? {} : { headers: { authorization: `Basic ${btoa(`admin:${password}`)}` } }), "1.2.3.4", gate, page, () => [], join(root, "src"));
    const dev: AdminGate = { dev: true, password: null, guesses: new Guesses(), tick: () => 0 };
    expect(ask(dev, "/index.html")).toBeNull();
    expect(ask(dev, "/sounds.html")!.status).toBe(200);
    expect(await ask(dev, "/admin/source/core/creatures/dodo/sound/brief.json")!.text()).toBe('{"slots":{}}');
    // Only the files of a sound folder are served, and nothing outside the sources.
    expect(ask(dev, "/admin/source/secret.txt")!.status).toBe(404);
    // The URL resolves dots before the board sees them: these are /admin/sounds.html and /package.json, not the board's.
    // The first is the admin pages', which answer it behind the same gate (admin-routes.test.ts).
    expect(ask(dev, "/admin/source/../sounds.html")).toBeNull();
    expect(ask(dev, "/admin/source/%2e%2e/%2e%2e/package.json")).toBeNull();
    // Escaped slashes are decoded as the board matches the path, and climb out of the sources: not the board's either.
    expect(ask(dev, "/admin/source/core%2f..%2f..%2fsecret.txt")).toBeNull();
    expect(ask(dev, "/admin/source/core%2f..%2fsecret.txt")!.status).toBe(404);
    // A server with no password and no --dev keeps it shut, in any case of the path: a file system may ignore case.
    expect(ask({ ...dev, dev: false }, "/sounds.html")!.status).toBe(404);
    for (const path of ["/Sounds.html", "/SOUNDS.HTML", "//sounds.html", "/%53ounds.html", "/Admin/sounds.json"]) expect([path, ask({ ...dev, dev: false }, path)?.status]).toEqual([path, 404]);
    expect(ask(dev, "/Sounds.html")!.status).toBe(200);
    const gate: AdminGate = { dev: false, password: "kiwi", guesses: new Guesses(), tick: () => 0 };
    const shut = ask(gate, "/sounds.html")!;
    expect(shut.status).toBe(401);
    expect(shut.headers.get("www-authenticate")).toContain("Basic");
    expect(ask(gate, "//sounds.html")!.status).toBe(401);
    expect(ask(gate, "/admin/sounds.json")!.status).toBe(401);
    expect(ask(gate, "/sounds.html", "kiwi")!.status).toBe(200);
    expect(ask(gate, "/admin/sounds.json", "kiwi")!.status).toBe(200);
    for (let k = 0; k < 3; k++) expect(ask(gate, "/sounds.html", "pear")!.status).toBe(401);
    // As enablecheats counts them: after three wrong guesses even the right one waits.
    expect(ask(gate, "/sounds.html", "kiwi")!.status).toBe(429);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

artTest("the board lists every owner by its folder, and each occasion by how the game hears it: its own, a stand-in, shared, or nothing", () => {
  // The repository's own folders: the dodo's and the shared families'.
  expect(soundFolders().map((f) => f.id)).toEqual(expect.arrayContaining(["core:dodo", "core:surface", "core:survivor"]));
  expect(soundFolders().some((f) => f.id === "core:ref")).toBe(false);
  const owners = boardOwners(reg, FAMILIES, SOURCE_DIR);
  const dodo = owners.find((o) => o.id === "core:dodo")!;
  expect(dodo.cls).toBe("species/creature");
  expect(dodo.folder).toBe(join("core", "creatures", "dodo", "sound"));
  expect(dodo.files).toEqual(expect.arrayContaining([join("core", "creatures", "dodo", "sound", "recipes.json"), join("core", "creatures", "dodo", "cues.json")]));
  expect(dodo.takes.call!.length).toBeGreaterThan(1);
  expect(owners.find((o) => o.id === "core:surface")!.cls).toBe("family");
  // A creature with sounds and no definition yet is listed with the creatures.
  expect(owners.find((o) => o.id === "core:rex")?.cls).toBe("species/creature");

  const built = builtSounds();
  const groups = listSounds(built.sounds, owners);
  const card = groups.find((g) => g.title === "Creatures")!.cards.find((c) => c.id === "core:dodo")!;
  const occasion = (name: string) => card.occasions.find((o) => o.name === name)!;
  expect(occasion("startled").label).toBe("alarm");
  expect(occasion("startled").variants).toEqual([{ key: "startled", word: "", by: "own", sound: "core:dodo/sound/startled", rate: 1 }]);
  expect(occasion("death").variants[0]).toMatchObject({ by: "stand-in", sound: "core:dodo/sound/hurt", rate: 0.88 });
  const steps = occasion("step/{ground}").variants;
  expect(steps.find((v) => v.word === "sand")).toMatchObject({ by: "own" });
  expect(steps.find((v) => v.word === "stone")).toMatchObject({ by: "stand-in", sound: "core:dodo/sound/step/grass" });
  // A creature has no hands: no swing or reload is listed for it. Voices come before steps.
  expect(card.occasions.some((o) => o.name.startsWith("swing/"))).toBe(false);
  expect(card.occasions.findIndex((o) => o.name === "call")).toBeLessThan(card.occasions.findIndex((o) => o.name === "step/{ground}"));
  // The peck is its own and heard as its attack's stand-in, so nothing is left over.
  expect(card.loose).toEqual([]);
  const surface = groups.flatMap((g) => g.cards).find((c) => c.id === "core:surface")!;
  expect(surface.occasions.find((o) => o.name === "step/{ground}")!.variants.every((v) => v.by === "none")).toBe(true);
  const takes = takesOf(built.sounds.find((s) => s.id === "core:dodo/sound/call")!, dodo);
  expect(takes[0]!.seconds).toBeGreaterThan(0.2);
  expect(takes.map((t) => t.from)).toEqual(["moss", "stable"]);
});
