// One list of the GPU's passes (D1121): the budget's panel and a note's census name each pass by the pass clock's own list
// (client/core/passes.ts PASSES), in its order, and a saved report carries the names beside its numbers, so a list
// changed later still reads an old report right.

import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { App } from "../../client/core/app.ts";
import { BudgetPanel } from "../../client/core/notes/budget.ts";
import { PASSES, PassClock, type QueryGl } from "../../client/core/passes.ts";
import { FramePacket } from "../../client/core/render/packet.ts";
import { ReportStore } from "../../server/reports.ts";
import { perf } from "../../tools/reports.ts";
import { jpegHead } from "../fixtures/jpeg.ts";

const ROOT = join(import.meta.dir, "../..");

/** A pass list with one more pass at its front, as a branch that times the walls' weathering is made gives it. */
const INSERTED = ["making", ...PASSES];

/** A panel given `frames` frames timed by pass: pass i took (i + 1) quarters of a millisecond, whatever its name. */
function timed(panel: BudgetPanel, frames = 4): BudgetPanel {
  const ms = Float64Array.from(panel.passNames, (_, i) => (i + 1) / 4);
  for (let f = 0; f < frames; f++) panel.passes(ms, 2);
  return panel;
}

test("the panel and the note's census take the pass clock's own list, with no copy of their own", () => {
  expect(new BudgetPanel().passNames).toBe(PASSES);
  // What the clock gives a frame by pass is a number for each pass of the same list.
  const gl: QueryGl = { getExtension: () => ({}), getParameter: () => false, isContextLost: () => false, createQuery: () => ({}), deleteQuery: () => {}, beginQuery: () => {}, endQuery: () => {}, getQueryParameter: (_q, name) => (name === 0x8867 ? true : 1e6), bindFramebuffer: () => {}, readPixels: () => {} };
  const clock = new PassClock(gl, true);
  for (let pass = 0; pass < PASSES.length; pass++) clock.mark(pass);
  clock.end();
  expect(clock.take()[0]!.length).toBe(new BudgetPanel().passNames.length);
  // No file of the mode names a pass of its own: the names that are passes alone, not a step's or a stage's too.
  const dir = join(ROOT, "client/core/notes");
  for (const file of readdirSync(dir)) for (const name of ["casters", "dome", "finish"]) expect(readFileSync(join(dir, file), "utf8").includes(`"${name}"`), `${file} names "${name}"`).toBe(false);
});

test("a pass inserted at the front of the list moves every label with it: the census's, the card's bar and its legend", () => {
  const panel = timed(new BudgetPanel(INSERTED));
  const times = panel.passTimes();
  expect(times.map((t) => t.name)).toEqual(INSERTED);
  expect(times.map((t) => t.ms)).toEqual(INSERTED.map((_, i) => (i + 1) / 4));
  // The real finish stays the last pass, and keeps its own time: it does not drop out.
  expect(times.at(-1)).toEqual({ name: "finish", ms: INSERTED.length / 4 });
  // The card's bar as the panel makes it, from a frame with nothing in it.
  const app = { frames: null, scene: null, governor: { level: 0, name: "" } } as unknown as App;
  (panel as unknown as { refresh: (app: App, p: FramePacket, now: number, timed: number, apple: boolean) => void }).refresh(app, new FramePacket(), 0, 2, false);
  const card = (panel as unknown as { bars: { label: string; parts: { name: string; value: number }[]; legend: string }[] }).bars[1]!;
  expect(card.parts.map((p) => [p.name, p.value])).toEqual(INSERTED.map((name, i) => [name, (i + 1) / 4]));
  expect(card.legend).toBe("finish 2.5 · body 2.3 · near see-through 2.0 · far see-through 1.8");
});

/** Report 1 sent to a store in `dir` as a page sends it, its one picture's census timed by `panel`. */
async function send(dir: string, panel: BudgetPanel): Promise<number> {
  const store = new ReportStore({ dir, root: ROOT, clientDir: dir, map: { id: "proving" } });
  const form = new FormData();
  form.set("token", "1:0011223344556677");
  form.set("report", JSON.stringify({ kind: "perf", ms: 1000, shots: [{ at: 0 }], text: [] }));
  form.append("shot", new Blob([jpegHead(1280, 720)], { type: "image/jpeg" }), "s.jpg");
  form.set("perf", JSON.stringify({ version: 1, fields: ["at", "interval"], frames: [[0, 16.7]], summary: { frames: 1 }, census: [{ shot: 0, steps: [], stores: [], largest: [], cpu: { frame: 1 }, gpu: panel.passTimes() }] }));
  const sent = new Response(form), type = sent.headers.get("content-type")!, body = await sent.arrayBuffer();
  const answer = await store.answer(new Request("http://localhost/__report", { method: "POST", body, headers: { "content-type": type, "content-length": String(body.byteLength) } }), { sender: () => ({ name: "owner", admin: true }), facts: () => ({}) });
  return ((await answer.json()) as { id: number }).id;
}

test("a report written with one list of passes reads back right under another", async () => {
  const dir = mkdtempSync(join(tmpdir(), "snark-pass-names-"));
  try {
    // Written by a page whose list had "making" first; read by a reader whose list does not.
    const id = await send(dir, timed(new BudgetPanel(INSERTED)));
    expect(PASSES as readonly string[]).not.toContain("making");
    const card = perf(dir, id).find((l) => l.includes("the card:"))!;
    expect(card).toBe(`  the processor: frame 1 ms; the card: ${INSERTED.map((name, i) => `${name} ${(i + 1) / 4} ms`).join(", ")}`);
    // And one written by today's list reads by its own names, each with its own time, whatever the reader's list says.
    const today = await send(dir, timed(new BudgetPanel()));
    expect(perf(dir, today).find((l) => l.includes("the card:"))).toBe(`  the processor: frame 1 ms; the card: ${PASSES.map((name, i) => `${name} ${(i + 1) / 4} ms`).join(", ")}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
