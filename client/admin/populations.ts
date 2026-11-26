// The populations page: the built-in and admin populations (server/admin/people-routes.ts), a population's fields, and
// a sheet of 24 of its people drawn one by one on the person stage, each one promotable to a named person on the people
// page. What it shows and decides is client/core/admin/populations.ts; this is the page's wiring.

import "./shell.ts";
import { REGIONS } from "../../shared/anim/look.ts";
import { REGION_KEYS } from "../../shared/content/kinds/populations.ts";
import { HAIR_BASE, SKIN_BASE } from "../../shared/pack/palette.ts";
import { STAGE_FRAMINGS, type StageFraming } from "../../shared/people/stage.ts";
import { $, esc, palette } from "./dom.ts";
import { FRAMING_WORDS, hexOf } from "../core/admin/wardrobe.ts";
import { promoteHref, rebase, retireThing, saveText, saveThing, copyPopulation, stageWear, storeStateOf, wearPieces, type SaveIo, type StoreState } from "../core/admin/people.ts";
import {
  SHEET_SIZE, SPANS, WEIGHT_LISTS, addOutfit, draftDef, draftOfBuiltIn, draftOfListed, pictureKey, populationFault, populationsHtml, promoteRef, removeOutfit, setLabel,
  setOutfitWeight, setPiece, setRegionSpan, setShare, setSpan, setWeight, sheetCaption, sheetChanges, sheetOf, sheetSeeds, weightsOf, type PopulationDraft, type SheetPerson,
} from "../core/admin/populations.ts";
import { StageLink, call, postJson } from "./stage-link.ts";

const API = "/admin/people/";
const SHEET_WAIT_MS = 300;
const PICTURE = { width: 180, height: 240 } as const;
/** Pictures kept at most, the oldest let go first. */
const KEPT = 240;

const S = {
  state: null as StoreState | null,
  draft: null as PopulationDraft | null,
  edited: false,
  busy: false,
  base: 1,
  sheet: [] as SheetPerson[],
  previous: [] as SheetPerson[],
};
const body = document.body.dataset;
const say = (text: string, kind = "dim"): void => {
  $("msg").textContent = text;
  $("msg").className = kind;
};
const failed = (err: unknown): void => say(err instanceof Error ? err.message : String(err), "bad");

const io: SaveIo = {
  save: (sent) => postJson(API + "save", sent),
  retire: (sent) => postJson(API + "retire", sent),
  wait: (ms) => new Promise((r) => setTimeout(r, ms)),
};

async function load(): Promise<void> {
  const a = await call(API + "state");
  const state = a.status === 200 ? storeStateOf(a.answer) : null;
  if (!state) throw new Error(`The store could not be read: ${String(a.answer.error ?? a.status)}`);
  S.state = state;
}

// ---- Drawing the editor ----

const selectedKey = (): string => (S.draft ? (S.draft.builtIn ?? `store:${S.draft.id}`) : "");
const readOnly = (): boolean => !!S.draft?.builtIn;

function drawList(): void {
  const st = S.state;
  if (!st) return;
  $("populations").innerHTML = populationsHtml(st, selectedKey());
  $("store").textContent = `Revision ${st.revision} · ${st.builtIns.length} built in, ${st.populations.length} made here`;
}

const num = (n: number): string => String(Math.round(n * 1000) / 1000);
const swatchOf = (key: string, i: number): string =>
  key === "skin" ? `<i class="sw" style="background:${hexOf(palette, SKIN_BASE + i)}"></i>` : key === "hairColors" ? `<i class="sw" style="background:${hexOf(palette, HAIR_BASE + i)}"></i>` : "";

function drawEditor(): void {
  const d = S.draft, st = S.state;
  $("editor").hidden = !d;
  $("no-draft").hidden = !!d;
  if (!d || !st) return;
  const ro = readOnly(), dis = ro ? " disabled" : "", doc = d.doc;
  $("read-only").hidden = !ro;
  const listed = d.id === null ? undefined : st.populations.find((p) => p.id === d.id);
  $("editor-title").textContent = ro ? `${doc.label} (built in, revision ${d.rev})` : `Population #${d.id}, revision ${d.rev}${S.edited ? ", edited" : ""}${listed?.retired ? " (retired)" : ""}`;
  const label = $<HTMLInputElement>("label");
  label.disabled = ro;
  if (document.activeElement !== label) label.value = doc.label;
  const share = (key: string, text: string, v: number): string => `<label>${esc(text)} <input type="number" min="0" max="1" step="0.05" data-share="${key}" value="${num(v)}"${dis}></label>`;
  $("shares").innerHTML = share("women", "Share of women", doc.women) + share("beard.men", "Men with beards", doc.beard.men) + share("beard.women", "Women with beards", doc.beard.women) +
    share("streak", "A second hair colour", doc.streak ?? 0) + share("face", "Face spread", doc.face);
  $("weights").innerHTML = WEIGHT_LISTS.map((l) => {
    const w = weightsOf(doc, l.key), on = w !== null;
    const head = l.optional ? `<label><input type="checkbox" data-weight-on="${l.key}"${on ? " checked" : ""}${dis}> ${esc(l.label)}</label>` : esc(l.label);
    const cells = on ? w!.map((v, i) => `<label>${swatchOf(l.key, i)}${esc(l.names[i]!)}<input type="number" min="0" step="0.1" data-weight="${l.key}" data-i="${i}" value="${num(v)}"${dis}></label>`).join("") : `<span class="faint">left out: every person has the first</span>`;
    return `<div class="weights"><h4>${head}</h4><div class="cells">${cells}</div></div>`;
  }).join("");
  $("spans").innerHTML = SPANS.map((s) => {
    const v = (doc as unknown as Record<string, readonly [number, number] | undefined>)[s.key], on = v !== undefined;
    const head = s.optional ? `<label><input type="checkbox" data-span-on="${s.key}"${on ? " checked" : ""}${dis}> ${esc(s.label)}</label>` : esc(s.label);
    const ends = on ? [0, 1].map((e) => `<input type="number" min="${s.least}" max="1" step="0.05" data-span="${s.key}" data-end="${e}" value="${num(v![e]!)}" aria-label="${e ? "High" : "Low"}"${dis}>`).join(" to ") : "";
    return `<div class="span"><span>${head}</span><span class="ends">${ends}</span></div>`;
  }).join("");
  $("regions").innerHTML = REGION_KEYS.map((k, r) => {
    const v = doc.regions?.[k];
    const ends = v ? [0, 1].map((e) => `<input type="number" min="-1" max="1" step="0.05" data-region="${k}" data-end="${e}" value="${num(v[e]!)}" aria-label="${e ? "High" : "Low"}"${dis}>`).join(" to ") : `<span class="faint">as every region</span>`;
    return `<div class="span"><span><label><input type="checkbox" data-region-on="${k}"${v ? " checked" : ""}${dis}> ${esc(REGIONS[r]!.label)}</label></span><span class="ends">${ends}</span></div>`;
  }).join("");
  const label2 = (id: string): string => st.garments.find((g) => g.id === id)?.label ?? st.armour.find((a) => a.id === id)?.label ?? id;
  const pieces = [...st.garments.map((g) => ({ id: g.id, text: `${g.label} (garment, ${g.slot})` })), ...st.armour.map((a) => ({ id: a.id, text: `${a.label} (armour)` }))];
  $("outfits").innerHTML = (doc.outfits ?? []).map((o, k) => {
    const chips = o.wear.map((w) => `<span class="chip piece">${esc(label2(w))}${ro ? "" : ` <button data-piece-off="${k}" data-piece="${esc(w)}" aria-label="Take off ${esc(label2(w))}">✕</button>`}</span>`).join(" ");
    const add = ro ? "" : `<select data-add-piece="${k}" aria-label="Add a piece"><option value="">Add a piece…</option>${pieces.filter((p) => !o.wear.includes(p.id)).map((p) => `<option value="${esc(p.id)}">${esc(p.text)}</option>`).join("")}</select>`;
    return `<div class="outfit" data-outfit="${k}"><b>Outfit ${k + 1}</b> ${chips || `<span class="faint">nothing</span>`} ${add} <label>Weight <input type="number" min="0.001" step="0.5" data-outfit-weight="${k}" value="${num(o.weight)}"${dis}></label>${ro ? "" : ` <button data-outfit-del="${k}" class="risk">Remove</button>`}</div>`;
  }).join("") || `<p class="faint">No outfits.</p>`;
  $<HTMLButtonElement>("add-outfit").hidden = ro;
  $("retire").hidden = ro || d.id === null;
  $("retire").textContent = listed?.retired ? "Bring back" : "Retire";
  drawFault();
}

function drawFault(): void {
  const fault = S.draft && S.state ? populationFault(S.draft.doc, S.state) : null;
  $("fault").textContent = fault ?? "";
  $<HTMLButtonElement>("save").hidden = readOnly();
  $<HTMLButtonElement>("save").disabled = S.busy || !!fault || !S.edited;
  $<HTMLButtonElement>("retire").disabled = S.busy;
}

function edited(): void {
  S.edited = true;
  drawEditor();
  sheetSoon(true);
}

function open(d: PopulationDraft | null): void {
  S.draft = d;
  S.edited = false;
  S.previous = [];
  S.sheet = [];
  history.replaceState(null, "", !d ? location.pathname : d.builtIn ? `?built=${encodeURIComponent(d.builtIn)}` : `?id=${d.id}`);
  drawList();
  drawEditor();
  sheetSoon();
}

// ---- The sheet ----

const stage = new StageLink($<HTMLIFrameElement>("stage"), () => {
  $("stage-note").textContent = "";
  void work().catch(failed);
}, (detail) => ($("stage-note").textContent = `The sheet cannot be drawn here: ${detail}`), (notes) => ($("stage-note").textContent = `The stage could not take all of it: ${notes.join("; ")}.`));
const pictures = new Map<string, string>();
let generation = 0, timer = 0, working = false;

let marking = false;

/** Draws the sheet soon; after an edit, its cards mark what the edit changed. */
function sheetSoon(edit = false): void {
  marking ||= edit;
  clearTimeout(timer);
  timer = window.setTimeout(() => drawSheet(), SHEET_WAIT_MS);
}

const framing = (): StageFraming => $<HTMLSelectElement>("framing").value as StageFraming;
const keyOf = (p: SheetPerson): string => `${framing()}|${pictureKey(p)}`;
const hex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

/** The sheet's people from the draft as it stands, its cards, then the pictures it lacks. */
function drawSheet(): void {
  const d = S.draft;
  if (!d) {
    $("sheet").innerHTML = "";
    return;
  }
  const people = sheetOf(draftDef(d, S.edited), sheetSeeds(S.base));
  const same = S.sheet.length > 0 && S.sheet[0]!.seed === people[0]!.seed;
  // An edit is judged against the sheet before it; another view keeps the marks of the last edit.
  if (marking) S.previous = same ? S.sheet : [];
  else if (!same) S.previous = [];
  marking = false;
  S.sheet = people;
  const changes = sheetChanges(S.previous, people), was = S.previous.length > 0;
  const promotable = promoteRef(d, S.edited) !== null;
  $("sheet").innerHTML = people.map((p, k) => {
    const c = changes[k]!, key = keyOf(p), url = pictures.get(key);
    const marks = was ? `${c.parts.length ? `<span class="chip moved" title="Changed: ${c.parts.join(", ")}">${esc(c.parts.join(", "))}</span>` : ""}${c.wear ? `<span class="chip rewear">clothes</span>` : ""}` : "";
    return `<figure class="card" data-k="${k}" data-seed="${p.seed}" data-look="${hex(p.look)}" data-wear="${esc(p.wear.join(","))}" data-key="${esc(key)}">
      ${url ? `<img src="${url}" alt="" width="${PICTURE.width}" height="${PICTURE.height}">` : `<div class="wait" style="aspect-ratio:${PICTURE.width}/${PICTURE.height}"></div>`}
      <figcaption>${esc(sheetCaption(p))}${marks}<br><button data-promote="${k}"${promotable ? "" : ` disabled title="Save the population first"`}>Promote</button></figcaption></figure>`;
  }).join("");
  const moved = changes.filter((c) => c.parts.length > 0).length, rewear = changes.filter((c) => c.wear).length;
  $("sheet-note").textContent = was ? `The last edit changed ${moved} of ${SHEET_SIZE} looks and ${rewear} of their clothes.` : "";
  body.sheetGen = String(++generation);
  void work().catch(failed);
}

/** Draws every picture the sheet lacks, one at a time, starting over when the sheet changes under it. */
async function work(): Promise<void> {
  if (working || !stage.ready || !S.state) return;
  working = true;
  try {
    for (;;) {
      const gen = generation, st = S.state!;
      const todo = S.sheet.filter((p) => !pictures.has(keyOf(p)));
      body.sheetLeft = String(todo.length);
      for (const p of todo) {
        if (gen !== generation) break;
        const key = keyOf(p);
        if (pictures.has(key)) continue;
        const { armour, worn } = wearPieces(st, p.wear), wear = stageWear(st, worn, armour);
        await stage.send({ kind: "look", look: p.look });
        await stage.send(wear.gear);
        await stage.send(wear.wardrobe);
        await stage.send({ kind: "pose", pose: "idle", at: 0.25 });
        await stage.send({ kind: "framing", framing: framing() });
        const url = URL.createObjectURL(await stage.picture(PICTURE.width, PICTURE.height));
        pictures.set(key, url);
        if (pictures.size > KEPT) {
          const [oldest, gone] = pictures.entries().next().value as [string, string];
          pictures.delete(oldest);
          URL.revokeObjectURL(gone);
        }
        for (const card of document.querySelectorAll<HTMLElement>(".card")) {
          if (card.dataset.key !== key) continue;
          card.querySelector(".wait")?.replaceWith(Object.assign(document.createElement("img"), { src: url, alt: "", width: PICTURE.width, height: PICTURE.height }));
        }
        body.sheetLeft = String(S.sheet.filter((x) => !pictures.has(keyOf(x))).length);
      }
      if (gen === generation) {
        body.sheetDrawn = String(gen);
        break;
      }
    }
  } finally {
    working = false;
  }
}

// ---- The page's controls ----

async function save(): Promise<void> {
  const d = S.draft, st = S.state;
  if (!d || !st || S.busy || d.builtIn) return;
  S.busy = true;
  drawFault();
  try {
    const o = await saveThing(io, "population", d.id, d.rev, d.doc, (attempt, ms) => say(`The store is busy. Trying again in ${ms} ms (try ${attempt + 1}).`, "warn"));
    if ((o.kind === "saved" || o.kind === "stale") && o.state) S.state = o.state;
    if (o.kind === "saved") {
      d.id = o.id;
      d.rev = o.rev;
      S.edited = false;
      S.previous = [];
    }
    if (o.kind === "stale") rebase(d, S.state, (s) => s.populations);
    say(saveText(o, `population ${d.id}`), o.kind === "saved" ? "well" : o.kind === "stale" ? "warn" : "bad");
    drawList();
    drawEditor();
    sheetSoon();
  } finally {
    S.busy = false;
    drawFault();
  }
}

async function copy(id: string): Promise<void> {
  if (S.busy || (S.edited && !confirm("Copy another population? Your edits go."))) return;
  S.busy = true;
  try {
    const o = await copyPopulation(io, id, undefined);
    if (o.kind === "saved" && o.state) {
      S.state = o.state;
      const made = o.state.populations.find((p) => p.id === o.id);
      if (made) open(draftOfListed(made));
      say(`Copied ${id} as population ${o.id}. Change it and save.`, "well");
    } else say(saveText(o, "the copy"), "bad");
  } finally {
    S.busy = false;
    drawFault();
  }
}

async function retire(): Promise<void> {
  const d = S.draft, st = S.state;
  if (!d || d.id === null || !st || S.busy) return;
  const retired = !st.populations.find((p) => p.id === d.id)?.retired;
  S.busy = true;
  try {
    const o = await retireThing(io, "population", d.id, retired, st.revision);
    if ((o.kind === "retired" || o.kind === "stale") && o.state) S.state = o.state;
    say(o.kind === "retired" ? (retired ? `Retired population ${d.id}. Its people stay as they are.` : `Population ${d.id} is back on the pick lists.`) : saveText(o, `population ${d.id}`), o.kind === "retired" ? "well" : "bad");
    drawList();
    drawEditor();
  } finally {
    S.busy = false;
    drawFault();
  }
}

document.addEventListener("click", (ev) => {
  const t = (ev.target as HTMLElement).closest<HTMLButtonElement>("button");
  if (!t || t.disabled || !S.state) return;
  const data = t.dataset, st = S.state, d = S.draft;
  const leave = (): boolean => !S.edited || confirm("Open another population? Your edits go.");
  if (data.openBuilt) {
    const p = st.builtIns.find((x) => x.id === data.openBuilt);
    if (p && leave()) open(draftOfBuiltIn(p));
  } else if (data.open) {
    const p = st.populations.find((x) => x.id === Number(data.open));
    if (p && leave()) open(draftOfListed(p));
  } else if (data.copy) void copy(data.copy).catch(failed);
  else if (data.promote !== undefined && d) {
    const p = S.sheet[Number(data.promote)], ref = promoteRef(d, S.edited);
    if (p && ref) location.assign(promoteHref(p.seed, ref.ref, ref.revision));
  } else if (data.pieceOff !== undefined && d) {
    setPiece(d.doc, Number(data.pieceOff), data.piece!, false);
    edited();
  } else if (data.outfitDel !== undefined && d) {
    removeOutfit(d.doc, Number(data.outfitDel));
    edited();
  } else if (t.id === "add-outfit" && d) {
    const first = st.garments[0]?.id ?? st.armour[0]?.id;
    if (!first) return say("This world has no garments or armour to wear.", "warn");
    if (!addOutfit(d.doc, [first])) return say("A population has 32 outfits at most.", "warn");
    edited();
  } else if (t.id === "new-faces") {
    S.base = (Math.random() * 0xffffffff) >>> 0;
    S.sheet = [];
    drawSheet();
  } else if (t.id === "redraw") {
    for (const url of pictures.values()) URL.revokeObjectURL(url);
    pictures.clear();
    drawSheet();
  } else if (t.id === "save") void save().catch(failed);
  else if (t.id === "retire") void retire().catch(failed);
  else if (t.id === "close" && leave()) open(null);
});

document.addEventListener("change", (ev) => {
  const t = ev.target as HTMLInputElement, data = t.dataset, d = S.draft;
  if (t.id === "framing") return drawSheet();
  if (!d || readOnly()) return;
  const v = Number(t.value), on = t.checked;
  if (t.id === "label") setLabel(d.doc, t.value);
  else if (data.share) setShare(d.doc, data.share as Parameters<typeof setShare>[1], v);
  else if (data.weightOn) setWeight(d.doc, data.weightOn as Parameters<typeof setWeight>[1], null, on ? 1 : 0);
  else if (data.weight) setWeight(d.doc, data.weight as Parameters<typeof setWeight>[1], Number(data.i), v);
  else if (data.spanOn) setSpan(d.doc, data.spanOn as Parameters<typeof setSpan>[1], null, on ? 1 : 0);
  else if (data.span) setSpan(d.doc, data.span as Parameters<typeof setSpan>[1], Number(data.end) as 0 | 1, v);
  else if (data.regionOn) setRegionSpan(d.doc, data.regionOn, on ? [-0.5, 0.5] : null);
  else if (data.region) {
    const was = d.doc.regions?.[data.region] ?? [-0.5, 0.5];
    setRegionSpan(d.doc, data.region, Number(data.end) === 0 ? [v, Math.max(v, was[1])] : [Math.min(v, was[0]), v]);
  } else if (data.addPiece !== undefined && t.value) setPiece(d.doc, Number(data.addPiece), t.value, true);
  else if (data.outfitWeight !== undefined) setOutfitWeight(d.doc, Number(data.outfitWeight), v);
  else return;
  edited();
});
addEventListener("beforeunload", (e) => {
  if (S.edited) e.preventDefault();
});

$("framing").innerHTML = STAGE_FRAMINGS.map((f) => `<option value="${f}"${f === "full" ? " selected" : ""}>${FRAMING_WORDS[f]}</option>`).join("");

load().then(() => {
  const st = S.state!, q = new URLSearchParams(location.search);
  const built = st.builtIns.find((p) => p.id === q.get("built")), mine = st.populations.find((p) => p.id === Number(q.get("id")));
  open(mine ? draftOfListed(mine) : built ? draftOfBuiltIn(built) : st.builtIns[0] ? draftOfBuiltIn(st.builtIns[0]) : null);
  say("");
  body.loaded = "1";
}, failed);
