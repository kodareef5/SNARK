// The wardrobe page: the cluster's garment editions (server/admin/people-routes.ts), a draft edition with its print
// drawn on a canvas sheet, and the person stage (client/entry/person-stage.ts) in an iframe, reached only by messages.
// What it shows and decides is client/core/admin/wardrobe.ts; this is the page's wiring.

import "./shell.ts";
import { STAGE_FRAMINGS, STAGE_POSES, isStageReply, stageMessage, type StageCommand, type StageFraming, type StagePose } from "../../shared/people/stage.ts";
import { $, esc, palette } from "./dom.ts";
import {
  DRAFT_PRINT, FONTS, FRAMING_WORDS, LOOKS, POSE_WORDS, SHEET_SIZES, TEXT_MAX, addPicture, addShape, addText, draftFaults, draftFrom, editionPrintKey, editionsHtml, fitNote, fitStep,
  fontOf, garmentsHtml, heldSize, hexOf, kb, layerAt, layerBox, layersHtml, lookOf, moveLayer, newDraft, newSheet, outcomeText, paletteHtml, placeOf, previewChanges,
  publishDraft, removeLayer, retireEdition, starPoints, stateOf, stepText, wardrobeCommand, type Answer, type Draft, type Fault, type Layer, type PeopleState, type Preview,
  type PublishIo, type Shape, type Sheet,
} from "../core/admin/wardrobe.ts";

const API = "/admin/people/";
/** The largest picture file the page reads. */
const PICTURE_FILE_MAX = 16 << 20;
const PREVIEW_WAIT_MS = 250;

type Picture = HTMLCanvasElement | ImageBitmap;

const S = {
  state: null as PeopleState | null,
  draft: null as Draft | null,
  faults: [] as Fault[],
  /** Which of the three colours a swatch sets. */
  well: 0,
  layer: 0,
  pictures: new Map<number, Picture>(),
  /** The edition the person wears, or 0 for the draft. */
  showing: 0,
  busy: false,
  printVersion: 0,
  seed: (Math.random() * 0xffffffff) >>> 0,
};

const body = document.body.dataset;
const say = (text: string, kind = "dim"): void => {
  $("msg").textContent = text;
  $("msg").className = kind;
};
const failed = (err: unknown): void => say(err instanceof Error ? err.message : String(err), "bad");

// ---- The routes ----

async function call(path: string, init: RequestInit): Promise<Answer> {
  try {
    const r = await fetch(API + path, { cache: "no-store", ...init });
    return { status: r.status, answer: (await r.json().catch(() => ({}))) as Record<string, unknown> };
  } catch {
    return { status: 0, answer: {} };
  }
}
const json = (path: string, sent: unknown): Promise<Answer> => call(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(sent) });
const io: PublishIo = {
  upload: (png) => call("print", { method: "POST", headers: { "content-type": "image/png" }, body: png.slice().buffer }),
  publish: (sent) => json("publish", sent),
  retire: (sent) => json("retire", sent),
  wait: (ms) => new Promise((r) => setTimeout(r, ms)),
};

async function load(): Promise<void> {
  const a = await call("state", {});
  const state = a.status === 200 ? stateOf(a.answer) : null;
  if (!state) throw new Error(`The store could not be read: ${String(a.answer.error ?? a.status)}`);
  S.state = state;
}

// ---- Drawing the sheet ----

/** Draws `sheet` on `g`, `width` x `height` pixels. */
function paintOn(g: CanvasRenderingContext2D, sheet: Sheet, width: number, height: number): void {
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, width, height);
  g.scale(width / sheet.width, height / sheet.height);
  if (sheet.fill) {
    g.fillStyle = sheet.fill;
    g.fillRect(0, 0, sheet.width, sheet.height);
  }
  for (const l of sheet.layers) {
    const b = layerBox(l, sheet.width, sheet.height);
    g.save();
    g.translate(b.x, b.y);
    g.rotate(-l.turn);
    if (l.kind === "text") {
      g.font = fontOf(l, b.h);
      g.fillStyle = l.colour;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(l.text, 0, 0);
    } else if (l.kind === "shape") {
      g.fillStyle = g.strokeStyle = l.colour;
      if (l.shape === "box") g.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
      else if (l.shape === "star") {
        g.beginPath();
        for (const [x, y] of starPoints(b.w / 2, b.h / 2)) g.lineTo(x, y);
        g.closePath();
        g.fill();
      } else {
        const line = l.shape === "ring" ? Math.min(b.w, b.h) * 0.12 : 0;
        g.beginPath();
        g.ellipse(0, 0, Math.max(0.5, b.w / 2 - line / 2), Math.max(0.5, b.h / 2 - line / 2), 0, 0, Math.PI * 2);
        if (line > 0) {
          g.lineWidth = line;
          g.stroke();
        } else g.fill();
      }
    } else {
      const p = S.pictures.get(l.id);
      if (p) g.drawImage(p, -b.w / 2, -b.h / 2, b.w, b.h);
    }
    g.restore();
  }
}

/** The sheet as a PNG of `width` x `height`. */
function encode(sheet: Sheet, width: number, height: number): Promise<Blob> {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  paintOn(c.getContext("2d")!, sheet, width, height);
  return new Promise((ok, fail) => c.toBlob((b) => (b ? ok(b) : fail(new Error("The sheet could not be made into a PNG."))), "image/png"));
}

/** The sheet's PNG under the store's cap, shrunk as it must be, and what to tell the admin of it. */
async function exportSheet(sheet: Sheet): Promise<{ png: Uint8Array; note: string } | { error: string }> {
  const cap = S.state!.caps.bytes;
  let width = sheet.width, height = sheet.height, blob = await encode(sheet, width, height);
  const first = blob.size;
  for (let tries = 1; ; tries++) {
    const fit = fitStep(width, height, blob.size, tries, cap);
    if (fit.kind === "keep") break;
    if (fit.kind === "fail") return { error: fit.reason };
    width = fit.width;
    height = fit.height;
    blob = await encode(sheet, width, height);
  }
  return { png: new Uint8Array(await blob.arrayBuffer()), note: fitNote({ width: sheet.width, height: sheet.height, bytes: first }, { width, height, bytes: blob.size }, cap) };
}

function paintSheet(): void {
  const sheet = S.draft?.sheet;
  if (!sheet) return;
  const c = $<HTMLCanvasElement>("sheet");
  if (c.width !== sheet.width) c.width = sheet.width;
  if (c.height !== sheet.height) c.height = sheet.height;
  const g = c.getContext("2d")!;
  paintOn(g, sheet, sheet.width, sheet.height);
  const picked = sheet.layers.find((l) => l.id === S.layer);
  if (picked) {
    const b = layerBox(picked, sheet.width, sheet.height);
    g.save();
    g.translate(b.x, b.y);
    g.rotate(-picked.turn);
    g.setLineDash([6, 4]);
    g.lineWidth = 2;
    g.strokeStyle = "#2878d5";
    g.strokeRect(-b.w / 2 - 3, -b.h / 2 - 3, b.w + 6, b.h + 6);
    g.restore();
  }
  paintPlace();
}

/** The garment's sheet with the print's rectangle, the print in it at its scale and turn; u runs across and v down. */
function paintPlace(): void {
  const d = S.draft;
  if (!d?.sheet) return;
  const c = $<HTMLCanvasElement>("place"), g = c.getContext("2d")!, W = c.width, H = c.height;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = "#e9edf2";
  g.fillRect(0, 0, W, H);
  g.strokeStyle = "#cfd8e2";
  g.lineWidth = 1;
  for (let k = 1; k < 4; k++) {
    g.beginPath();
    g.moveTo((W * k) / 4, 0);
    g.lineTo((W * k) / 4, H);
    g.moveTo(0, (H * k) / 4);
    g.lineTo(W, (H * k) / 4);
    g.stroke();
  }
  const p = placeOf(d.place, S.state!.caps), x = p.u * W, y = p.v * H, w = p.w * W, h = p.h * H;
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  const pw = w * p.scale, ph = (pw * d.sheet.height) / d.sheet.width;
  g.translate(x + w / 2, y + h / 2);
  g.rotate(-p.turn);
  g.drawImage($<HTMLCanvasElement>("sheet"), -pw / 2, -ph / 2, pw, ph);
  g.restore();
  g.setLineDash([5, 4]);
  g.strokeStyle = "#24588d";
  g.lineWidth = 2;
  g.strokeRect(x, y, w, h);
}

// ---- Drawing the page ----

const garmentOf = (id: string) => S.state?.garments.find((g) => g.id === id);

function drawLists(): void {
  const st = S.state;
  if (!st) return;
  $("editions").innerHTML = editionsHtml(st, palette, S.showing);
  $("garments").innerHTML = garmentsHtml(st);
  const live = st.editions.filter((e) => !e.retired).length;
  $("store").textContent = `Revision ${st.revision} · ${st.editions.length === 1 ? "1 edition" : `${st.editions.length} editions`}, ${live} on the pick list`;
}

const num = (n: number): string => String(Math.round(n * 1000) / 1000);
const field = (name: string, label: string, value: string | number, attrs: string, cls = ""): string => `<label${cls ? ` class="${cls}"` : ""}>${label}<input data-lf="${name}" value="${esc(String(value))}" ${attrs}></label>`;

function layerFieldsHtml(l: Layer | undefined): string {
  if (!l) return "";
  const turn = field("turn", "Turn, degrees", Math.round((l.turn * 180) / Math.PI) || 0, `type="number" min="-180" max="180" step="1"`);
  const at = field("x", "Across", num(l.x), `type="range" min="0" max="1" step="0.005"`) + field("y", "Down", num(l.y), `type="range" min="0" max="1" step="0.005"`) + turn;
  if (l.kind === "text") {
    const fonts = FONTS.map((f) => `<option${f === l.font ? " selected" : ""}>${esc(f)}</option>`).join("");
    return field("text", "Text", l.text, `maxlength="${TEXT_MAX}" autocomplete="off"`, "wide") + `<label>Font<select data-lf="font">${fonts}</select></label>` + field("size", "Size", num(l.size), `type="range" min="0.03" max="0.6" step="0.005"`) + field("colour", "Colour", l.colour, `type="color"`) + `<label><span><input type="checkbox" data-lf="bold"${l.bold ? " checked" : ""}> Bold</span></label>` + at;
  }
  if (l.kind === "shape") return field("colour", "Colour", l.colour, `type="color"`) + field("w", "Width", num(l.w), `type="range" min="0.02" max="1.5" step="0.005"`) + field("h", "Height", num(l.h), `type="range" min="0.02" max="1.5" step="0.005"`) + at;
  return field("w", "Width", num(l.w), `type="range" min="0.02" max="2" step="0.005"`) + at + `<p class="faint wide">${esc(l.name)}, held at ${l.width} × ${l.height}.</p>`;
}

function placeFieldsHtml(d: Draft): string {
  const p = placeOf(d.place, S.state!.caps), caps = S.state!.caps;
  const f = (name: string, label: string, value: number, attrs: string): string => `<label>${label}<input data-pf="${name}" type="number" value="${num(value)}" ${attrs}></label>`;
  return f("u", "From the left", p.u, `min="0" max="1" step="0.01"`) + f("v", "From the top", p.v, `min="0" max="1" step="0.01"`) + f("w", "Width", p.w, `min="0.01" max="1" step="0.01"`) + f("h", "Height", p.h, `min="0.01" max="1" step="0.01"`) +
    f("scale", "Scale", p.scale, `min="${caps.scaleMin}" max="${caps.scaleMax}" step="0.05"`) + f("turn", "Turn, degrees", Math.round((p.turn * 180) / Math.PI), `min="-180" max="180" step="1"`);
}

/** Draws the editor from the draft; the field in hand keeps what is typed in it. */
function drawEditor(): void {
  const d = S.draft, st = S.state;
  $("editor").hidden = !d;
  $("no-draft").hidden = !!d;
  if (!d || !st) return;
  const g = garmentOf(d.garment);
  $("garment").innerHTML = st.garments.map((x) => `<option value="${esc(x.id)}"${x.id === d.garment ? " selected" : ""}>${esc(x.label)}</option>`).join("");
  const name = $<HTMLInputElement>("name");
  if (document.activeElement !== name) name.value = d.name;
  name.maxLength = st.caps.name;
  $("wells").innerHTML = d.colours.map((c, k) => `<button data-well="${k}" class="${k === S.well ? "on" : ""}"${g && !g.dyes ? " disabled" : ""}>${c === 0 ? `<i class="sw own"></i>` : `<i class="sw" style="background:${hexOf(palette, c)}"></i>`}Colour ${k + 1}</button>`).join("");
  $("palette").innerHTML = paletteHtml(palette, d.colours[S.well]!);
  $("palette").hidden = !!g && !g.dyes;
  $("colour-note").textContent = g && !g.dyes ? `The ${g.label} keeps its own colours.` : "0 is the garment's own colour. A player's dye goes over these.";
  $<HTMLInputElement>("has-print").checked = !!d.sheet;
  $("print").hidden = !d.sheet;
  if (d.sheet) {
    const sheet = d.sheet;
    $("sheet-size").innerHTML = SHEET_SIZES.map(([w, h]) => `<option value="${w}x${h}"${w === sheet.width && h === sheet.height ? " selected" : ""}>${w} × ${h}</option>`).join("") +
      (SHEET_SIZES.some(([w, h]) => w === sheet.width && h === sheet.height) ? "" : `<option selected value="${sheet.width}x${sheet.height}">${sheet.width} × ${sheet.height}</option>`);
    $<HTMLInputElement>("clear").checked = sheet.fill === null;
    $<HTMLInputElement>("fill").disabled = sheet.fill === null;
    if (sheet.fill) $<HTMLInputElement>("fill").value = sheet.fill;
    $("layers").innerHTML = layersHtml(sheet, S.layer, S.faults);
    $("layer").innerHTML = layerFieldsHtml(sheet.layers.find((l) => l.id === S.layer));
    $("place-fields").innerHTML = placeFieldsHtml(d);
    paintSheet();
  }
  drawFaults();
}

function drawFaults(): void {
  $("faults").innerHTML = S.faults.map((f) => `<li>${esc(f.text)}</li>`).join("");
  $<HTMLButtonElement>("publish").disabled = S.busy || S.faults.length > 0;
  $<HTMLButtonElement>("discard").disabled = S.busy;
}

/** The draft changed: checked again, the sheet redrawn, and the person sent it soon. */
function edited(sheet: boolean, redraw = false): void {
  if (!S.draft || !S.state) return;
  S.faults = draftFaults(S.draft, S.state);
  if (sheet) S.printVersion++;
  if (S.showing !== 0) {
    S.showing = 0;
    drawLists();
  }
  if (redraw) drawEditor();
  else {
    paintSheet();
    drawFaults();
    if (S.draft.sheet) $("layers").innerHTML = layersHtml(S.draft.sheet, S.layer, S.faults);
  }
  $("fit-note").textContent = "";
  soon();
}

function begin(d: Draft | null): void {
  for (const p of S.pictures.values()) if ("close" in p) p.close();
  S.pictures.clear();
  S.draft = d;
  S.layer = 0;
  S.well = 0;
  S.showing = 0;
  S.faults = d && S.state ? draftFaults(d, S.state) : [];
  S.printVersion++;
  $("fit-note").textContent = "";
  drawLists();
  drawEditor();
  soon();
}

const hasWork = (): boolean => !!S.draft && (S.draft.name.trim() !== "" || (S.draft.sheet?.layers.length ?? 0) > 0);

// ---- The person stage ----

const stageFrame = $<HTMLIFrameElement>("stage");
let ready = false, nextId = 0, sent = 0, taken = 0;
const asked = new Map<number, { kind: StageCommand["kind"]; url?: string }>();
let shown: Preview | null = null, timer = 0, sending = false, again = false;
body.stage = "loading";

function post(c: StageCommand, url?: string): void {
  const id = ++nextId;
  asked.set(id, { kind: c.kind, ...(url ? { url } : {}) });
  sent++;
  body.stageSent = String(sent);
  stageFrame.contentWindow?.postMessage(stageMessage({ ...c, id }), location.origin);
}

function soon(): void {
  clearTimeout(timer);
  timer = window.setTimeout(() => void send().catch(failed), PREVIEW_WAIT_MS);
}

/** What the person should wear now: the edition shown, or the draft. */
function wanted(): { preview: Preview; wardrobe: Extract<StageCommand, { kind: "wardrobe" }>; print: (() => Promise<string>) | null; printKey: string } {
  const look = `${$<HTMLSelectElement>("look").value}:${S.seed}`;
  const pose = $<HTMLSelectElement>("pose").value, framing = $<HTMLSelectElement>("framing").value, hour = Number($<HTMLInputElement>("hour").value);
  const e = S.showing ? S.state?.editions.find((x) => x.id === S.showing) : undefined;
  let wardrobe = wardrobeCommand(undefined, 0, [0, 0, 0], null), print: (() => Promise<string>) | null = null, key = "", version = "";
  if (e) {
    key = e.print ? editionPrintKey(e.print.hash) : "";
    wardrobe = wardrobeCommand(garmentOf(e.garment), e.id, e.colours, key || null);
    const path = e.printPath;
    if (path) print = () => Promise.resolve(path);
    version = key;
  } else if (S.draft) {
    const sheet = S.draft.sheet;
    key = sheet ? DRAFT_PRINT : "";
    wardrobe = wardrobeCommand(garmentOf(S.draft.garment), 0, S.draft.colours, key || null);
    if (sheet) print = async () => URL.createObjectURL(await encode(sheet, sheet.width, sheet.height));
    version = sheet ? `${DRAFT_PRINT}#${S.printVersion}` : "";
  }
  return { preview: { look, wardrobe: JSON.stringify(wardrobe.slots), print: version, pose, framing, hour }, wardrobe, print, printKey: key };
}

async function send(): Promise<void> {
  if (!ready) return;
  if (sending) return void (again = true);
  sending = true;
  try {
    const w = wanted();
    const e = S.showing ? S.state?.editions.find((x) => x.id === S.showing) : undefined;
    $("showing").textContent = e ? `Wearing edition ${e.id}` : S.draft ? "Wearing the draft" : "Wearing nothing from here";
    for (const kind of previewChanges(shown, w.preview)) {
      if (kind === "look") post({ kind, look: lookOf($<HTMLSelectElement>("look").value, S.seed) });
      else if (kind === "print" && w.print) {
        const url = await w.print();
        post({ kind, key: w.printKey, url, png: null }, url.startsWith("blob:") ? url : undefined);
      } else if (kind === "wardrobe") post(w.wardrobe);
      else if (kind === "pose") post({ kind, pose: w.preview.pose as StagePose, at: null });
      else if (kind === "framing") post({ kind, framing: w.preview.framing as StageFraming });
      else if (kind === "hour") post({ kind, hour: w.preview.hour });
    }
    shown = w.preview;
  } finally {
    sending = false;
    if (again) {
      again = false;
      soon();
    }
  }
}

addEventListener("message", (e) => {
  if (e.source !== stageFrame.contentWindow || e.origin !== location.origin || !isStageReply(e.data)) return;
  const a = e.data;
  if (a.kind === "ready") {
    ready = true;
    body.stage = "ready";
    $("stage-note").textContent = "";
    shown = null;
    void send().catch(failed);
    return;
  }
  if (a.kind === "error") {
    body.stage = "error";
    $("stage-note").textContent = `The person cannot be drawn here: ${a.detail}`;
    return;
  }
  const was = a.id === undefined ? undefined : asked.get(a.id);
  if (a.id !== undefined) asked.delete(a.id);
  if (was?.url) URL.revokeObjectURL(was.url);
  taken++;
  body.stageTaken = String(taken);
  if (a.kind === "picture") {
    // The last picture's address stays good until the next, so it can be saved again from the page.
    if (body.picture) URL.revokeObjectURL(body.picture);
    const link = document.createElement("a");
    link.href = body.picture = URL.createObjectURL(a.png as Blob);
    link.download = `wardrobe-${(S.draft?.name || "person").replace(/[^A-Za-z0-9]+/g, "-").toLowerCase()}.png`;
    link.click();
    body.pictures = String(Number(body.pictures ?? 0) + 1);
    $("stage-note").textContent = `Saved a picture, ${a.width} × ${a.height}.`;
    return;
  }
  if (a.notes.length > 0) {
    body.stageNotes = String(Number(body.stageNotes ?? 0) + a.notes.length);
    $("stage-note").textContent = `The person could not take all of it: ${a.notes.join("; ")}.`;
  } else if ((a.of === "wardrobe" || a.of === "print") && (a.held as { drawn?: boolean } | null)?.drawn === false) {
    $("stage-note").textContent = a.of === "print" ? "The person wears the garment, but draws its print only once prints are drawn." : "The person holds the garment, but draws it only once its cut is made.";
  }
});

// ---- The page's controls ----

async function publish(): Promise<void> {
  const d = S.draft, st = S.state;
  if (!d || !st || S.busy) return;
  S.faults = draftFaults(d, st);
  if (S.faults.length > 0) return drawFaults();
  S.busy = true;
  drawFaults();
  try {
    let png: Uint8Array | null = null;
    if (d.sheet) {
      const made = await exportSheet(d.sheet);
      if ("error" in made) return say(`Not published: ${made.error}`, "bad");
      png = made.png;
      $("fit-note").textContent = made.note;
    }
    const o = await publishDraft(io, d, png, st.revision, (s) => say(stepText(s), s.kind === "busy" ? "warn" : "dim"));
    if (o.kind === "published" || o.kind === "stale") {
      if (o.state) S.state = o.state;
      else await load();
    }
    say(outcomeText(o, st), o.kind === "published" ? "well" : o.kind === "stale" ? "warn" : "bad");
    if (o.kind === "published") {
      const note = $("fit-note").textContent;
      begin(null);
      $("fit-note").textContent = note;
      S.showing = o.id;
      drawLists();
      soon();
    } else drawLists();
  } finally {
    S.busy = false;
    drawFaults();
  }
}

async function retire(id: number, retired: boolean): Promise<void> {
  const st = S.state;
  if (!st || S.busy) return;
  S.busy = true;
  try {
    const o = await retireEdition(io, id, retired, st.revision, (s) => say(stepText(s), s.kind === "busy" ? "warn" : "dim"));
    if (o.kind === "retired" || o.kind === "stale") {
      if (o.state) S.state = o.state;
      else await load();
    }
    say(o.kind === "retired" ? (retired ? `Retired edition ${id}. It stays on whoever wears it.` : `Edition ${id} is back on the pick list.`) : outcomeText(o, st), o.kind === "retired" ? "well" : o.kind === "stale" ? "warn" : "bad");
    drawLists();
  } finally {
    S.busy = false;
    drawFaults();
  }
}

/** Reads a picture file into a layer, shrunk as it is read if it is big. */
async function takePicture(file: File): Promise<void> {
  const d = S.draft;
  if (!d?.sheet) return;
  if (file.size > PICTURE_FILE_MAX) return say(`That file is ${kb(file.size)}; the page reads pictures of ${kb(PICTURE_FILE_MAX)} at most.`, "warn");
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return say(`${file.name} could not be read as a picture.`, "warn");
  }
  const natural = { width: bitmap.width, height: bitmap.height }, held = heldSize(natural.width, natural.height);
  let picture: Picture = bitmap;
  if (held.width !== natural.width) {
    const c = document.createElement("canvas");
    c.width = held.width;
    c.height = held.height;
    c.getContext("2d")!.drawImage(bitmap, 0, 0, held.width, held.height);
    bitmap.close();
    picture = c;
  }
  const l = addPicture(d.sheet, file.name, held.width, held.height);
  if (!l) return say("The sheet holds no more layers.", "warn");
  S.pictures.set(l.id, picture);
  S.layer = l.id;
  say(held.width !== natural.width ? `${file.name} was ${natural.width} × ${natural.height}; it is held at ${held.width} × ${held.height}.` : `Added ${file.name}.`);
  edited(true, true);
}

/** Begins a draft from a published edition, its print as a picture filling the sheet. */
async function startFrom(id: number): Promise<void> {
  const e = S.state?.editions.find((x) => x.id === id);
  if (!e || (hasWork() && !confirm("Put a copy of this edition in place of the draft?"))) return;
  const d = draftFrom(e);
  begin(d);
  if (e.printPath && d.sheet) {
    const bitmap = await createImageBitmap(await (await fetch(e.printPath)).blob());
    const l = addPicture(d.sheet, `edition ${e.id}'s print`, bitmap.width, bitmap.height) as Extract<Layer, { kind: "picture" }>;
    l.w = 1;
    S.pictures.set(l.id, bitmap);
    edited(true, true);
  }
  say(`A copy of edition ${e.id}. Change it and publish it as a new edition.`);
}

document.addEventListener("click", (ev) => {
  const t = (ev.target as HTMLElement).closest<HTMLButtonElement>("button");
  if (!t || t.disabled) return;
  const d = S.draft, sheet = d?.sheet, data = t.dataset;
  if (data.start) {
    if (hasWork() && !confirm("Start again? The draft goes.")) return;
    begin(newDraft(data.start));
    say("A new draft. Name it, colour it, and give it a print if it has one.");
  } else if (data.show) {
    S.showing = Number(data.show);
    drawLists();
    soon();
  } else if (data.copy) void startFrom(Number(data.copy)).catch(failed);
  else if (data.retire) void retire(Number(data.retire), data.retired === "1").catch(failed);
  else if (data.well !== undefined) {
    S.well = Number(data.well);
    drawEditor();
  } else if (data.colour !== undefined && d) {
    d.colours[S.well] = Number(data.colour);
    if (S.well < 2) S.well++;
    edited(false, true);
  } else if (data.add && sheet) {
    if (data.add === "picture") return $<HTMLInputElement>("picture-file").click();
    const l = data.add === "text" ? addText(sheet) : addShape(sheet, $<HTMLSelectElement>("shape-kind").value as Shape);
    if (!l) return say("The sheet holds no more layers.", "warn");
    S.layer = l.id;
    edited(true, true);
  } else if (data.pickLayer) {
    S.layer = Number(data.pickLayer);
    drawEditor();
  } else if ((data.layerUp || data.layerDown) && sheet) {
    // The list is topmost first: up is drawn later.
    moveLayer(sheet, Number(data.layerUp ?? data.layerDown), data.layerUp ? 1 : -1);
    edited(true, true);
  } else if (data.layerDel && sheet) {
    const id = Number(data.layerDel);
    removeLayer(sheet, id);
    const p = S.pictures.get(id);
    if (p && "close" in p) p.close();
    S.pictures.delete(id);
    if (S.layer === id) S.layer = 0;
    edited(true, true);
  } else if (t.id === "publish") void publish().catch(failed);
  else if (t.id === "discard") {
    if (!hasWork() || confirm("Discard the draft?")) begin(null);
  } else if (t.id === "reroll") {
    S.seed = (Math.random() * 0xffffffff) >>> 0;
    soon();
  } else if (t.id === "stage-picture") {
    if (!ready) return void ($("stage-note").textContent = "The person is not drawn yet.");
    post({ kind: "picture", width: 720, height: 900 });
  }
});

/** A field's change, as it is typed or slid. */
function changed(t: HTMLInputElement | HTMLSelectElement, final: boolean): void {
  const d = S.draft, sheet = d?.sheet;
  if (t.id === "name" && d) {
    d.name = t.value;
    return edited(false);
  }
  if (["look", "pose", "framing", "hour"].includes(t.id)) return soon();
  if (!d) return;
  if (t.id === "garment") {
    d.garment = t.value;
    if (garmentOf(d.garment)?.dyes === false) d.colours = [0, 0, 0];
    return edited(false, true);
  }
  if (t.id === "has-print") {
    d.sheet = (t as HTMLInputElement).checked ? (d.sheet ?? newSheet()) : null;
    return edited(true, true);
  }
  if (!sheet) return;
  if (t.id === "sheet-size") {
    const [w, h] = t.value.split("x").map(Number);
    sheet.width = w!;
    sheet.height = h!;
    return edited(true, true);
  }
  if (t.id === "fill" || t.id === "clear") {
    sheet.fill = $<HTMLInputElement>("clear").checked ? null : $<HTMLInputElement>("fill").value;
    $<HTMLInputElement>("fill").disabled = sheet.fill === null;
    return edited(true);
  }
  if (t.dataset.pf) {
    const v = Number(t.value);
    if (!Number.isFinite(v)) return;
    const key = t.dataset.pf as keyof Draft["place"];
    d.place = { ...d.place, [key]: key === "turn" ? (v * Math.PI) / 180 : v };
    if (final) d.place = placeOf(d.place, S.state!.caps);
    return edited(false, final);
  }
  const l = sheet.layers.find((x) => x.id === S.layer);
  const k = t.dataset.lf;
  if (!l || !k) return;
  const v = t.value;
  const o = l as Record<string, unknown>;
  if (k === "text" || k === "font" || k === "colour") o[k] = v;
  else if (k === "bold") o[k] = (t as HTMLInputElement).checked;
  else if (k === "turn") o[k] = (Number(v) * Math.PI) / 180 || 0;
  else if (Number.isFinite(Number(v))) o[k] = Number(v);
  edited(true, final && (k === "text" || k === "font"));
}

document.addEventListener("input", (e) => changed(e.target as HTMLInputElement, false));
document.addEventListener("change", (e) => {
  const t = e.target as HTMLInputElement;
  if (t.id === "picture-file") {
    const file = t.files?.[0];
    t.value = "";
    if (file) void takePicture(file).catch(failed);
    return;
  }
  changed(t, true);
});

// Dragging a layer on the sheet moves it.
const sheetCanvas = $<HTMLCanvasElement>("sheet");
let drag: { id: number; x: number; y: number } | null = null;
const sheetPoint = (e: PointerEvent): [number, number] => {
  const r = sheetCanvas.getBoundingClientRect(), sheet = S.draft!.sheet!;
  return [((e.clientX - r.left) / r.width) * sheet.width, ((e.clientY - r.top) / r.height) * sheet.height];
};
sheetCanvas.addEventListener("pointerdown", (e) => {
  const sheet = S.draft?.sheet;
  if (!sheet) return;
  const [x, y] = sheetPoint(e);
  const l = layerAt(sheet, x, y);
  if (!l) return;
  sheetCanvas.setPointerCapture(e.pointerId);
  drag = { id: l.id, x, y };
  if (S.layer !== l.id) {
    S.layer = l.id;
    drawEditor();
  }
});
sheetCanvas.addEventListener("pointermove", (e) => {
  const sheet = S.draft?.sheet, l = sheet?.layers.find((x) => x.id === drag?.id);
  if (!drag || !sheet || !l) return;
  const [x, y] = sheetPoint(e);
  l.x = Math.min(1, Math.max(0, l.x + (x - drag.x) / sheet.width));
  l.y = Math.min(1, Math.max(0, l.y + (y - drag.y) / sheet.height));
  drag = { id: drag.id, x, y };
  edited(true);
});
const dropped = (): void => {
  if (!drag) return;
  drag = null;
  drawEditor();
};
sheetCanvas.addEventListener("pointerup", dropped);
sheetCanvas.addEventListener("pointercancel", dropped);

addEventListener("beforeunload", (e) => {
  if (hasWork()) e.preventDefault();
});

$("look").innerHTML = LOOKS.map((l) => `<option value="${esc(l.id)}">${esc(l.label)}</option>`).join("");
$("pose").innerHTML = STAGE_POSES.map((p) => `<option value="${p}">${POSE_WORDS[p]}</option>`).join("");
$("framing").innerHTML = STAGE_FRAMINGS.map((f) => `<option value="${f}"${f === "three-quarter" ? " selected" : ""}>${FRAMING_WORDS[f]}</option>`).join("");

load().then(() => {
  say("");
  drawLists();
  body.loaded = "1";
}, failed);
