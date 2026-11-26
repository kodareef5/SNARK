// The wardrobe admin page against the real people routes and store: the admin build makes its page, the site serves it,
// and the page's publish and retire calls (client/core/admin/wardrobe.ts) go through upload, publish, 409 and retire.
import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addText, newDraft, newSheet, publishDraft, retireEdition, stateOf, type Answer, type PublishIo } from "../../client/core/admin/wardrobe.ts";
import { peopleAdmin } from "../../server/admin/people-routes.ts";
import { adminSite } from "../../server/admin/site.ts";
import { PeopleStore } from "../../server/people/store.ts";
import { encodePng } from "../../tools/snap/png.ts";
import { buildAdmin } from "../../tools/build-admin.ts";
import { coreRegistry } from "../fixtures/world.ts";

const root = mkdtempSync(join(tmpdir(), "snark-wardrobe-page-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const reg = coreRegistry();

test("the admin build makes the wardrobe page, which the site serves with its script and style", async () => {
  const dist = join(root, "dist");
  await buildAdmin(dist);
  for (const f of ["wardrobe.html", "wardrobe.js", "wardrobe.css"]) expect(existsSync(join(dist, "admin", f))).toBe(true);
  const html = readFileSync(join(dist, "admin/wardrobe.html"), "utf8");
  expect([html.includes('src="/admin/ui/wardrobe.js"'), html.includes('href="/admin/ui/wardrobe.css"'), html.includes('src="/person-stage.html"')]).toEqual([true, true, true]);
  const site = {
    dir: dist, base: "", port: 0, id: "local" as const, who: "test", destinations: () => [], scenes: () => new Response(null),
    gate: { dev: true, password: null, guesses: null as never, tick: () => 0 },
  };
  const get = async (path: string): Promise<Response> => (await adminSite(new Request(`http://snark.test${path}`), new URL(`http://snark.test${path}`), site))!;
  for (const path of ["/admin/ui/wardrobe.js", "/admin/ui/wardrobe.css"]) expect((await get(path)).status).toBe(200);
  const page = await get("/admin/wardrobe/");
  expect([page.status, (await page.text()).includes('id="sheet"')]).toEqual([200, true]);
  expect((await get("/admin/wardrobe")).headers.get("location")).toBe("/admin/wardrobe/");
});

/** The page's calls, answered by the people routes over `store`, as a development world's open page makes them. */
function routes(store: PeopleStore): PublishIo {
  const answer = async (path: string, body: string | Uint8Array, type: string): Promise<Answer> => {
    const length = typeof body === "string" ? new TextEncoder().encode(body).length : (body as Uint8Array).length;
    const req = new Request(`http://snark.test/admin/people/${path}`, { method: "POST", body: body as unknown as string, headers: { "content-type": type, "content-length": String(length) } });
    const r = await peopleAdmin(req, `/admin/people/${path}`, store, () => reg)!;
    return { status: r.status, answer: (await r.json()) as Record<string, unknown> };
  };
  return {
    upload: (png) => answer("print", png, "image/png"),
    publish: (body) => answer("publish", JSON.stringify(body), "application/json"),
    retire: (body) => answer("retire", JSON.stringify(body), "application/json"),
    wait: async () => {},
  };
}

test("the page publishes a print, meets a stale revision, publishes again and retires", async () => {
  const dir = join(root, "store");
  const store = new PeopleStore({ db: join(dir, "people.sqlite"), media: join(dir, "media"), tmp: join(dir, "tmp") });
  try {
    const io = routes(store);
    const d = newDraft("core:tee", "tee");
    d.name = "Page tee";
    d.colours = [34, 0, 11];
    d.sheet = newSheet();
    d.sheet.height = 256;
    addText(d.sheet);
    const png = encodePng(512, 256, Uint8Array.from({ length: 512 * 256 * 4 }, (_, i) => (i % 4 === 3 ? 255 : (i * 7) & 0xff)));
    const first = await publishDraft(io, d, png, store.view().revision);
    expect(first).toMatchObject({ kind: "published", id: 1, state: { revision: 1 } });
    expect(store.view().byId.get(1)).toMatchObject({ name: "Page tee", colours: [34, 0, 11], print: { width: 512, height: 256, place: { u: 0.06, scale: 1 } } });

    // Another admin publishes over revision 1; the page, still at 1, is refused and shown the store as it is.
    const theirs = await io.publish({ revision: 1, garment: "core:jeans", colours: [0, 0, 0], name: "Theirs", print: null });
    expect(theirs.status).toBe(200);
    d.name = "Page tee two";
    const stale = await publishDraft(io, d, png, 1);
    expect(stale.kind).toBe("stale");
    const now = stale.kind === "stale" ? stale.state! : null;
    expect(now?.editions.map((e) => e.name)).toEqual(["Page tee", "Theirs"]);
    // The same print uploaded twice is answered as known, and the publish over the newer revision goes in.
    const again = await publishDraft(io, d, png, now!.revision);
    expect(again).toMatchObject({ kind: "published", id: 3, upload: { known: true } });

    const retired = await retireEdition(io, 1, true, store.view().revision);
    expect(retired.kind === "retired" && retired.state?.editions.find((e) => e.id === 1)?.retired).toBe(true);
    expect(await retireEdition(io, 1, false, 0)).toMatchObject({ kind: "stale" });
    expect(stateOf({ revision: "x" })).toBeNull();
  } finally {
    store.close();
  }
});
