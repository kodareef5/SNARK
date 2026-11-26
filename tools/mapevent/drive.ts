// The events page worked in headless Chrome as an admin works it (planning/workstreams/map-events.md), each act judged by
// what the server then holds: a schedule switched off, a fault shown at its field and holding Save back, a kind's
// tuning saved, a kind switched off and on, what a seed would make drawn and then called, the call hurried, brought down
// and ended, and an old revision brought back. Run it after any change to the page.

import { join } from "node:path";
import type { Host } from "../../server/host.ts";
import { wireCraft } from "../../shared/mapevent/wire.ts";
import { browse, type Page } from "../loadout/drive.ts";

/** The selector of a field of the draft by its path. */
const field = (path: readonly (string | number)[]): string => `[data-path='${JSON.stringify(path)}']`;

/** Waits `ms` of the server's own time, which runs as the wall clock does. */
const pause = (ms: number): Promise<void> => Bun.sleep(ms);

async function view(page: Page, name: string): Promise<void> {
  if (!(await page.wait(`!!document.querySelector('[data-view="${name}"]')`))) throw new Error(`the page has no ${name} tab: it says "${await page.run(`document.querySelector("#said")?.textContent ?? document.body.innerText.slice(0, 200)`)}"`);
  await page.press(`[data-view="${name}"]`);
  await page.wait(`document.querySelector('[data-view="${name}"]')?.classList.contains("on") && !document.querySelector("#main")?.textContent?.includes("reading…")`);
}

async function save(page: Page, note: string): Promise<void> {
  await page.type("#note", note);
  await page.press('[data-do="save"]');
  await page.wait(`document.querySelector("#said")?.textContent?.startsWith("saved as revision")`);
}

export async function drive(chrome: string, url: string, host: Host, scratch: string): Promise<string[]> {
  return browse(chrome, url, scratch, async (page) => {
    const faults: string[] = [];
    const check = (ok: boolean, what: string): void => void (ok || faults.push(what));
    const store = host.eventBook;
    check(await page.wait(`[...document.querySelectorAll("#main h3")].some((h) => h.textContent === "UFO")`), "the library shows the UFO");

    // A schedule switched off and saved, with its note.
    await view(page, "schedules");
    await page.press(field(["schedules", 1, "on"]));
    await save(page, "no UFO by day");
    check(store.book.revision === 1 && store.book.schedules[1]?.on === false && store.revisions().at(-1)?.note === "no UFO by day", `a schedule switched off is saved as revision 1 (revision ${store.book.revision})`);

    // A fault at its field holds Save back; mended, the kind's tuning is saved, and only what differs from its default.
    await view(page, "tuning");
    await page.type(field(["tuning", "ufo", "health"]), "0");
    await page.tab();
    check(await page.wait(`document.querySelector('[data-do="save"]')?.disabled === true && document.querySelector(${JSON.stringify(field(["tuning", "ufo", "health"]))})?.classList.contains("wrong")`), "a health of 0 is a fault at its field, and Save waits");
    await page.type(field(["tuning", "ufo", "health"]), "40000");
    await page.tab();
    await save(page, "a softer craft");
    check(JSON.stringify(store.book.tuning) === JSON.stringify({ ufo: { health: 40000 } }), `the UFO's health is saved alone (${JSON.stringify(store.book.tuning)})`);

    // A kind switched off, and on again: on is said by not naming it.
    await view(page, "library");
    await page.press(field(["kinds", "ufo", "on"]));
    await save(page, "no UFO");
    check(store.book.kinds.ufo?.on === false, "the UFO is switched off in the book");
    await page.press(field(["kinds", "ufo", "on"]));
    await save(page, "the UFO again");
    check(Object.keys(store.book.kinds).length === 0, "the UFO is on again, and the book names no kind");

    // What a seed would make, drawn; called with that seed, it is what was drawn.
    await view(page, "map");
    await page.type("#seed", "4242");
    await page.press('[data-do="preview"]');
    check(await page.wait(`document.querySelector("#main")?.textContent?.includes("Seed 4242")`), "the map says what seed 4242 would make");
    await page.press('[data-do="callseed"]');
    check(await page.wait(`document.querySelector("#said")?.textContent?.startsWith("called")`), "the page says the call was made");
    const made = host.mapEvents.events.find((e) => e.seed === 4242);
    const preview = host.mapEvents.preview("ufo", 4242);
    check(!!made && typeof preview !== "string" && JSON.stringify(made.crafts[0]!.points) === JSON.stringify(wireCraft(preview.crafts[0]!.spec).points), "the call flies the path the map drew");

    // Hurried, brought down and ended from the live view, each as the console does it.
    if (made) {
      await view(page, "live");
      await page.press(`[data-do="hurry"][data-id="${made.id}"]`);
      await pause(400);
      check(made.state === 1, `hurried, the event has come (its state is ${made.state})`);
      await page.press('[data-do="relive"]');
      check(await page.wait(`!!document.querySelector('[data-do="down"][data-id="${made.id}"]')`), "a live event can be brought down from the page");
      await page.press(`[data-do="down"][data-id="${made.id}"]`);
      check(made.crafts[0]!.down > 0, "brought down from the page, its craft falls");
      await page.press(`[data-do="cancel"][data-id="${made.id}"]`);
      check(made.state === 2, "ended from the page");
    }

    // An old revision compared and brought back, as the next.
    await view(page, "revisions");
    await page.press('[data-do="compare"][data-id="1"]');
    check(await page.wait(`document.querySelector("#main")?.textContent?.includes("From revision 1 to the draft")`), "a revision is compared with the draft");
    const before = store.book.revision;
    await page.press('[data-do="restore"][data-id="1"]');
    check(await page.wait(`document.querySelector("#said")?.textContent?.includes("is revision")`), "the page says the revision came back");
    check(store.book.revision === before + 1 && store.book.schedules[1]?.on === false && Object.keys(store.book.tuning).length === 0, "revision 1 is the book in force again, as the next revision");
    check(page.dialogs.length === 1, `one question was asked, before the restore (${page.dialogs.length})`);
    for (const e of page.errors) faults.push(`the page raised: ${e}`);
    return faults;
  });
}

/** Each view pictured into `dist/shots/`, with an event called so what is live is drawn. */
export async function shots(chrome: string, url: string, host: Host, dist: string, scratch: string): Promise<string[]> {
  const made = host.mapEvents.call("ufo", { source: "page", notice: 1, seed: 7, near: [{ x: host.world.hf.sizeX / 2, z: host.world.hf.sizeZ / 2 }] });
  if (typeof made === "string") return [made];
  await pause(1500);
  return browse(chrome, url, scratch, async (page) => {
    const out = join(dist, "shots");
    await Bun.write(join(out, ".keep"), "");
    for (const name of ["library", "schedules", "tuning", "live", "revisions"]) {
      await view(page, name);
      await page.shot(join(out, `${name}.png`));
    }
    await view(page, "map");
    await page.type("#seed", "4242");
    await page.press('[data-do="preview"]');
    await page.wait(`document.querySelector("#main")?.textContent?.includes("Seed 4242")`);
    await page.shot(join(out, "map.png"));
    console.log(`pictures in ${out}`);
    return page.errors.map((e) => `the page raised: ${e}`);
  });
}
