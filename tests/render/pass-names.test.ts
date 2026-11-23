// One list of the GPU's passes: the debug bar's span ring names the card's passes and the draw's by the pass clock's own
// list (client/core/passes.ts PASSES), in its order, and a saved capture carries the names beside its times, so a list
// changed later still reads an old capture right.

import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LANE_CARD, SpanFrame, SpanRing } from "../../client/core/debug/spans.ts";
import { PASSES, PASS_FINISH, PASS_MAKING, PASS_UPLOADS, PassClock, type QueryGl } from "../../client/core/passes.ts";
import { ReportStore } from "../../server/reports.ts";
import { perf } from "../../tools/reports.ts";
import { jpegHead } from "../fixtures/jpeg.ts";

const ROOT = join(import.meta.dir, "../..");

/** The slots under `parent`, by name, in the order they were made. */
const under = (ring: SpanRing, parent: number): string[] => ring.names.filter((_, s) => ring.parents[s] === parent);

test("the span ring takes the pass clock's own list for the card and the draw", () => {
  const ring = new SpanRing({ now: () => 0 });
  expect(under(ring, LANE_CARD)).toEqual([...PASSES]);
  expect(under(ring, ring.names.indexOf("gl"))).toEqual([...PASSES]);
  expect([PASSES[PASS_MAKING], PASSES[PASS_UPLOADS], PASSES[PASS_FINISH], PASS_FINISH]).toEqual(["making", "uploads", "finish", PASSES.length - 1]);
  // What the clock gives a frame by pass is a number for each pass of the same list.
  const gl: QueryGl = { getExtension: () => ({}), getParameter: () => false, isContextLost: () => false, createQuery: () => ({}), deleteQuery: () => {}, beginQuery: () => {}, endQuery: () => {}, getQueryParameter: (_q, name) => (name === 0x8867 ? true : 1e6), bindFramebuffer: () => {}, readPixels: () => {} };
  const clock = new PassClock(gl, true);
  for (let pass = 0; pass < PASSES.length; pass++) clock.mark(pass);
  clock.end();
  expect(clock.take()[0]!.length).toBe(PASSES.length);
  // No file of the bar names a pass of its own: the names that are passes alone.
  const dir = join(ROOT, "client/core/debug");
  for (const file of readdirSync(dir)) for (const name of ["casters", "dome", "finish"]) expect(readFileSync(join(dir, file), "utf8").includes(`"${name}"`), `${file} names "${name}"`).toBe(false);
});

test("the card's passes go end to end, each by its name and with its own time", () => {
  let now = 0;
  const ring = new SpanRing({ now: () => now });
  ring.begin(0);
  ring.card(Float64Array.from(PASSES, (_, i) => (i + 1) / 4), 2);
  now = 30;
  ring.close(new Float64Array(5), null);
  const f = ring.read(ring.row(0), new SpanFrame());
  const card = ring.names.map((_, s) => s).filter((s) => ring.parents[s] === LANE_CARD);
  expect(card.map((s) => [ring.names[s], f.ms[s]])).toEqual(PASSES.map((name, i) => [name, (i + 1) / 4]));
  // Laid one after another from the frame's start.
  expect(card.map((s) => f.start[s])).toEqual(PASSES.map((_, i) => (i * (i + 1)) / 8));
});

/** A capture sent to a store in `dir` as the bar sends it, whose frames were timed with `passes` named so. */
async function send(dir: string, passes: readonly string[]): Promise<number> {
  const store = new ReportStore({ dir, root: ROOT, clientDir: dir, map: { id: "proving" } });
  const names = ["frame", "card", ...passes], parents = [-1, -1, ...passes.map(() => 1)];
  const ms = [10, passes.length, ...passes.map((_, i) => (i + 1) / 4)], start = [0, 0, ...passes.map((_, i) => i)];
  const form = new FormData();
  form.set("token", "1:0011223344556677");
  form.set("report", JSON.stringify({ kind: "capture", ms: 1000, shots: [{ at: 0 }], text: [] }));
  form.append("shot", new Blob([jpegHead(1280, 720)], { type: "image/jpeg" }), "s.jpg");
  form.set("perf", JSON.stringify({ version: 1, fields: ["at", "interval"], frames: [[0, 16.7]], summary: { frames: 1 }, spans: { names, parents, mean: { frames: 60, start, ms }, slowest: [] } }));
  const sent = new Response(form), type = sent.headers.get("content-type")!, body = await sent.arrayBuffer();
  const answer = await store.answer(new Request("http://localhost/__report", { method: "POST", body, headers: { "content-type": type, "content-length": String(body.byteLength) } }), { sender: () => ({ name: "owner", admin: true }), facts: () => ({}) });
  return ((await answer.json()) as { id: number }).id;
}

test("a capture written with one list of passes reads back by its own names", async () => {
  const dir = mkdtempSync(join(tmpdir(), "snark-pass-names-"));
  try {
    // Written by a page whose list had no "making"; read by a reader whose list has it first.
    const older = PASSES.filter((name) => name !== "making");
    const id = await send(dir, older);
    const lines = perf(dir, id), at = lines.findIndex((l) => l.includes("the card, by pass"));
    expect(at).toBeGreaterThan(0);
    const card = lines.slice(at + 1, at + 1 + older.length).map((l) => l.trim().split(/\s+/).slice(0, -2).join(" "));
    expect(card).toEqual(older);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
