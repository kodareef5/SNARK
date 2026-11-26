// The people page: the cluster's named people (server/admin/people-routes.ts), a person's draft with each part locked or
// drawn again, the person stage in an iframe, and a role bound in a world's Cast (POST cast). What it shows and decides
// is client/core/admin/people.ts; this is the page's wiring.

import { adminContext } from "./shell.ts";
import { BEARD_STYLES, HAIR_STYLES, LOOK_HAIR_COLOR, LOOK_SKIN, REGIONS, REGION_COUNT, SEX_LABELS } from "../../shared/anim/look.ts";
import { PART_NAMES, type PartName } from "../../shared/people/doc.ts";
import { HAIR_BASE, HAIR_COLORS, SKIN_BASE, SKIN_TONES } from "../../shared/pack/palette.ts";
import { STAGE_FRAMINGS, STAGE_POSES, type StageFraming, type StagePose } from "../../shared/people/stage.ts";
import { WARDROBE_NAMES } from "../../shared/sim/items.ts";
import { address, type AdminWorld } from "../core/admin/navigation.ts";
import { $, esc, palette } from "./dom.ts";
import { FRAMING_WORDS, POSE_WORDS, hexOf, paletteHtml } from "../core/admin/wardrobe.ts";
import {
  EYE_WORDS, HAIR_COLOUR_WORDS, PART_WORDS, backToDrawn, bookOf, castHtml, castRolesOf, choosePopulation, draftOf, drawAgain, editionsOf, emptyWardrobe, featureOp,
  garmentsFor, handValue, isLocked, lookBytes, newPerson, partSummary, peopleHtml, personDoc, personFaults, personWear, populationChoices, populationLabel, promotedFrom,
  rebase, refKey, refOfKey, rerollPart, retireThing, roleOp, roleOptions, saveText, saveThing, setByHand, setLock, storeStateOf, type CastRoles, type Fault, type HandField,
  type PersonDraft, type PopulationBook, type SaveIo, type StoreState,
} from "../core/admin/people.ts";
import { StageLink, call, postJson } from "./stage-link.ts";

const API = "/admin/people/";
const PREVIEW_WAIT_MS = 200;

const S = {
  state: null as StoreState | null,
  book: new Map() as PopulationBook,
  draft: null as PersonDraft | null,
  faults: [] as Fault[],
  busy: false,
  /** Stands for a body's own seed where the look is fixed, for what an outfit's choices give. */
  bodySeed: (Math.random() * 0xffffffff) >>> 0,
  /** The dye well in hand: slot and which of its three. */
  well: null as { slot: number; k: number } | null,
  cast: null as CastRoles | null,
  castApi: "",
  dirty: false,
};
const body = document.body.dataset;
const say = (text: string, kind = "dim"): void => {
  $("msg").textContent = text;
  $("msg").className = kind;
};
const failed = (err: unknown): void => say(err instanceof Error ? err.message : String(err), "bad");
const random = (): number => (Math.random() * 0xffffffff) >>> 0;

const io: SaveIo = {
  save: (sent) => postJson(API + "save", sent),
  retire: (sent) => postJson(API + "retire", sent),
  wait: (ms) => new Promise((r) => setTimeout(r, ms)),
};

/** The store's state, and every population revision its manifest holds. */
async function load(): Promise<void> {
  const a = await call(API + "state");
  const state = a.status === 200 ? storeStateOf(a.answer) : null;
  if (!state) throw new Error(`The store could not be read: ${String(a.answer.error ?? a.status)}`);
  await take(state);
}

async function take(state: StoreState): Promise<void> {
  let manifest: unknown = null;
  if (state.manifest) manifest = (await call(state.manifest.path)).answer;
  S.state = state;
  S.book = bookOf(state, manifest);
}

// ---- Drawing the page ----

const bytesNow = (): Uint8Array | null => (S.draft && S.state ? lookBytes(S.draft.look, S.state, S.book) : null);

function drawList(): void {
  const st = S.state;
  if (!st) return;
  $("people").innerHTML = peopleHtml(st, S.draft?.id ?? null);
  const live = st.people.filter((p) => !p.retired).length;
  $("store").textContent = `Revision ${st.revision} · ${st.people.length === 1 ? "1 person" : `${st.people.length} people`}, ${live} not retired`;
}

const options = (list: readonly { value: string; text: string }[], at: string): string => list.map((o) => `<option value="${esc(o.value)}"${o.value === at ? " selected" : ""}>${esc(o.text)}</option>`).join("");

function drawLook(): void {
  const d = S.draft!, st = S.state!, look = d.look, bytes = bytesNow();
  const drawn = look.kind === "seed" ? look : look.drawn;
  $("look-mode").innerHTML = look.kind === "seed"
    ? `Drawn from seed <b>${look.seed}</b> in ${esc(populationLabel(st, S.book, look.population, look.revision))} (revision ${look.revision}). A part locked keeps its own seed when the person is drawn again; hair and beard are drawn for the sex, so they keep only while it does.`
    : `Fixed by hand: the look is kept as its 72 bytes.${drawn ? ` It came from seed ${drawn.seed}; drawing a part again copies that part from a new person of ${esc(populationLabel(st, S.book, drawn.population, drawn.revision))}.` : " Drawing a part again copies that part from a new person of the city crowd."}`;
  const choices = populationChoices(st), at = drawn ? refKey(drawn.population) : "";
  const listed = choices.map((c) => ({ value: refKey(c.ref), text: `${c.label}${typeof c.ref === "number" ? ` (#${c.ref})` : ""}` }));
  if (drawn && !listed.some((o) => o.value === at)) listed.push({ value: at, text: `${populationLabel(st, S.book, drawn.population, drawn.revision)} (retired)` });
  $("population").innerHTML = options(listed, at);
  const seed = $<HTMLInputElement>("seed");
  seed.disabled = look.kind !== "seed";
  if (document.activeElement !== seed) seed.value = look.kind === "seed" ? String(look.seed) : "";
  $("back-to-drawn").hidden = !(look.kind === "bytes" && look.drawn);
  $("parts").innerHTML = PART_NAMES.map((p) => {
    const now = p === "outfit" ? outfitWords() : bytes ? partSummary(p, bytes) : "?";
    const own = look.kind === "seed" && look.locks[p] !== undefined && look.locks[p] !== look.seed ? ` <span class="faint">seed ${look.locks[p]}</span>` : "";
    const off = p === "outfit" && (look.kind === "bytes" || d.dress.kind !== "outfit");
    return `<tr data-part="${p}"><td>${PART_WORDS[p]}</td><td class="now">${esc(now)}${own}</td><td><input type="checkbox" data-lock="${p}"${isLocked(look, p) ? " checked" : ""}${off ? " disabled" : ""} aria-label="Lock ${PART_WORDS[p]}"></td><td><button data-reroll="${p}"${off ? " disabled" : ""}>Draw again</button></td></tr>`;
  }).join("");
  if (bytes) drawHand(bytes);
}

function outfitWords(): string {
  const d = S.draft!;
  if (d.dress.kind !== "outfit") return d.dress.kind === "wardrobe" ? "its own wardrobe" : "the role's clothes";
  if (d.look.kind === "bytes") return "drawn by each body";
  return `choices from seed ${d.look.locks.outfit ?? d.look.seed}`;
}

const slider = (field: HandField, label: string, value: number): string =>
  `<label>${esc(label)} <input type="range" min="-1" max="1" step="0.01" data-hand="${field}" value="${value.toFixed(2)}"><output>${Math.round(value * 100)}</output></label>`;

function drawHand(bytes: Uint8Array): void {
  const pick = (field: HandField, label: string, names: readonly string[]): string =>
    `<label>${esc(label)} <select data-hand="${field}">${names.map((n, i) => `<option value="${i}"${handValue(bytes, field) === i ? " selected" : ""}>${esc(n)}</option>`).join("")}</select></label>`;
  const active = document.activeElement as HTMLElement | null;
  if (active?.dataset.hand) return;
  $("hand-picks").innerHTML = pick("sex", "Sex", SEX_LABELS) + pick("hair", "Hair style", HAIR_STYLES.map((s) => s.label)) + pick("beard", "Beard", BEARD_STYLES.map((s) => s.label)) + pick("eyes", "Eyes", EYE_WORDS);
  const sw = (field: HandField, base: number, n: number, at: number, words: (i: number) => string): string =>
    Array.from({ length: n }, (_, i) => `<button class="sw${i === at ? " on" : ""}" data-hand-pick="${field}" data-value="${i}" style="background:${hexOf(palette, base + i)}" title="${esc(words(i))}" aria-label="${esc(words(i))}"></button>`).join("");
  $("skin-swatches").innerHTML = sw("skin", SKIN_BASE, SKIN_TONES, bytes[LOOK_SKIN]!, (i) => `Skin tone ${i + 1}`);
  $("hair-swatches").innerHTML = sw("hairColour", HAIR_BASE, HAIR_COLORS, bytes[LOOK_HAIR_COLOR]!, (i) => HAIR_COLOUR_WORDS[i] ?? `colour ${i}`);
  $("figure-sliders").innerHTML = slider("age", "Age", handValue(bytes, "age")) + slider("weight", "Weight", handValue(bytes, "weight")) + slider("muscle", "Muscle", handValue(bytes, "muscle"));
  $("region-sliders").innerHTML = Array.from({ length: REGION_COUNT }, (_, r) => slider(`region:${r}`, REGIONS[r]!.label, handValue(bytes, `region:${r}`))).join("");
}

function drawDress(): void {
  const d = S.draft!, st = S.state!;
  for (const r of document.querySelectorAll<HTMLInputElement>('input[name="dress"]')) r.checked = r.value === d.dress.kind;
  $("outfit-pick").hidden = d.dress.kind !== "outfit";
  $("wardrobe").hidden = d.dress.kind !== "wardrobe";
  if (d.dress.kind === "outfit") {
    const at = String(d.dress.outfit);
    $("outfit").innerHTML = options(st.outfits.filter((o) => !o.retired || String(o.id) === at).map((o) => ({ value: String(o.id), text: `${o.doc.name} (#${o.id})` })), at);
  }
  if (d.dress.kind === "wardrobe") {
    const slots = d.dress.slots;
    $("slots").innerHTML = WARDROBE_NAMES.map((name, i) => {
      const w = slots[i] ?? null, garments = garmentsFor(st, i), g = st.garments.find((x) => x.id === w?.garment);
      const garmentSel = `<select data-slot-garment="${i}" aria-label="The ${name}"><option value="">Nothing</option>${garments.map((x) => `<option value="${esc(x.id)}"${x.id === w?.garment ? " selected" : ""}>${esc(x.label)}</option>`).join("")}</select>`;
      const eds = w ? editionsOf(st, w.garment) : [];
      const editionSel = w ? `<select data-slot-edition="${i}" aria-label="Its edition"><option value="0">Plain</option>${eds.map((e) => `<option value="${e.id}"${e.id === w.edition ? " selected" : ""}>${esc(e.name)} (#${e.id})${e.retired ? ", retired" : ""}</option>`).join("")}</select>` : "";
      const wells = w && g?.dyes ? w.dye.map((c, k) => `<button class="sw${c === 0 ? " own" : ""}${S.well?.slot === i && S.well.k === k ? " on" : ""}" data-well="${i}:${k}" ${c ? `style="background:${hexOf(palette, c)}"` : ""} title="Dye ${k + 1}: ${c || "its own"}" aria-label="Dye ${k + 1}"></button>`).join("") : w ? `<span class="faint">own colours</span>` : "";
      return `<tr${S.faults.some((f) => f.at === `slot:${i}`) ? ` class="wrong"` : ""}><td>${name}</td><td>${garmentSel}</td><td>${editionSel}</td><td>${wells}</td></tr>`;
    }).join("");
    const w = S.well ? slots[S.well.slot] : null;
    $("dye-palette").hidden = !w;
    if (w && S.well) $("dye-palette").innerHTML = paletteHtml(palette, w.dye[S.well.k]!);
  }
}

function drawEditor(): void {
  const d = S.draft;
  $("editor").hidden = !d;
  $("no-draft").hidden = !!d;
  drawFaults();
  drawCast();
  if (!d || !S.state) return;
  const listed = d.id === null ? undefined : S.state.people.find((p) => p.id === d.id);
  $("editor-title").textContent = d.id === null ? "A new person" : `Person #${d.id}, revision ${d.rev}${listed?.retired ? " (retired)" : ""}`;
  const name = $<HTMLInputElement>("name"), notes = $<HTMLTextAreaElement>("notes");
  if (document.activeElement !== name) name.value = d.name;
  if (document.activeElement !== notes) notes.value = d.notes;
  $("retire").hidden = d.id === null;
  $("retire").textContent = listed?.retired ? "Bring back" : "Retire";
  drawLook();
  drawDress();
}

function drawFaults(): void {
  $("faults").innerHTML = S.faults.map((f) => `<li>${esc(f.text)}</li>`).join("");
  $<HTMLButtonElement>("save").disabled = S.busy || S.faults.length > 0;
  $<HTMLButtonElement>("retire").disabled = S.busy;
}

/** The draft changed: checked again, redrawn, and the person sent it soon. */
function edited(redraw = true): void {
  if (!S.draft || !S.state) return;
  S.dirty = true;
  S.faults = personFaults(S.draft, S.state, S.book);
  if (redraw) drawEditor();
  else drawFaults();
  soon();
}

function open(d: PersonDraft | null): void {
  S.draft = d;
  S.well = null;
  S.dirty = false;
  S.faults = d && S.state ? personFaults(d, S.state, S.book) : [];
  history.replaceState(null, "", d?.id ? `?id=${d.id}` : location.pathname);
  drawList();
  drawEditor();
  soon();
}

// ---- The person stage ----

const stage = new StageLink($<HTMLIFrameElement>("stage"), () => {
  $("stage-note").textContent = "";
  shown = "";
  soon();
}, (detail) => ($("stage-note").textContent = `The person cannot be drawn here: ${detail}`), (notes) => ($("stage-note").textContent = `The person could not take all of it: ${notes.join("; ")}.`));
let shown = "", timer = 0, sending = false, again = false;
const shownPrints = new Set<string>();

function soon(): void {
  clearTimeout(timer);
  timer = window.setTimeout(() => void send().catch(failed), PREVIEW_WAIT_MS);
}

async function send(): Promise<void> {
  if (!stage.ready || !S.state) return;
  if (sending) return void (again = true);
  sending = true;
  try {
    const bytes = bytesNow();
    const { wear, note } = S.draft ? personWear(S.draft, S.state, S.bodySeed) : { wear: personWear(newPerson(S.state, 0), S.state, 0).wear, note: "" };
    $("wear-note").textContent = note;
    const pose = $<HTMLSelectElement>("pose").value as StagePose, framing = $<HTMLSelectElement>("framing").value as StageFraming;
    const key = JSON.stringify([bytes ? [...bytes] : null, wear.gear.armor, wear.wardrobe.slots, pose, framing]);
    if (key === shown) return;
    if (bytes) await stage.send({ kind: "look", look: bytes });
    for (const p of wear.prints) {
      if (shownPrints.has(p.key)) continue;
      await stage.send({ kind: "print", key: p.key, url: p.url, png: null });
      shownPrints.add(p.key);
    }
    await stage.send(wear.gear);
    const took = await stage.send(wear.wardrobe);
    const holds = wear.wardrobe.slots.some((g) => g) && took.kind === "applied" && (took.held as { drawn?: boolean } | null)?.drawn === false;
    $("stage-note").textContent = holds ? "The person holds the garments, but draws them only once their cuts are made." : "";
    await stage.send({ kind: "pose", pose, at: null });
    await stage.send({ kind: "framing", framing });
    shown = key;
    body.previewed = bytes ? Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("") : "";
  } finally {
    sending = false;
    if (again) {
      again = false;
      soon();
    }
  }
}

// ---- Cast ----

const readUrl = (href: string, base?: string) => new URL(href, base);

/** The worlds on this server's origin, whose Cast the page can reach. */
async function drawWorlds(): Promise<void> {
  let worlds: AdminWorld[] = [];
  try {
    worlds = (await adminContext()).worlds;
  } catch {
    // A page with no world directory binds no role.
  }
  const here = worlds.flatMap((w) => {
    try {
      const url = address(w, location.origin, readUrl);
      return url.origin === location.origin ? [{ value: new URL("admin/", url.href).href, text: w.name }] : [];
    } catch {
      return [];
    }
  });
  $("world").innerHTML = here.length ? options(here, here[0]!.value) : `<option value="">No world on this server</option>`;
  S.castApi = here[0]?.value ?? "";
  await readCast();
}

async function readCast(): Promise<void> {
  if (!S.castApi) {
    S.cast = null;
    return drawCast();
  }
  const a = await call(S.castApi + "cast.json");
  S.cast = a.status === 200 ? castRolesOf(a.answer) : null;
  body.castRead = String(Number(body.castRead ?? 0) + 1);
  drawCast();
}

function drawCast(): void {
  const st = S.state, person = S.draft?.id ?? null;
  const role = $<HTMLSelectElement>("role"), was = role.value;
  if (!S.cast || !st) {
    role.innerHTML = "";
    $("cast").innerHTML = `<p class="faint">${S.castApi ? "This world's Cast could not be read." : "Open this page on a world's server to give a person a role."}</p>`;
    $<HTMLButtonElement>("bind").disabled = true;
    return;
  }
  role.innerHTML = roleOptions(S.cast, st, person);
  if (was && [...role.options].some((o) => o.value === was)) role.value = was;
  $<HTMLButtonElement>("bind").disabled = person === null || S.cast.roles.length === 0;
  $("cast").innerHTML = castHtml(S.cast, person);
}

async function castAct(sent: object, done: string): Promise<void> {
  const r = await postJson(S.castApi + "cast", sent);
  if (r.answer.ok === true) say(done, "well");
  else say(`Cast did not take it: ${String(r.answer.why ?? r.status)}`, "bad");
  await readCast();
}

// ---- The page's controls ----

async function save(): Promise<void> {
  const d = S.draft, st = S.state;
  if (!d || !st || S.busy) return;
  S.faults = personFaults(d, st, S.book);
  if (S.faults.length > 0) return drawFaults();
  S.busy = true;
  drawFaults();
  try {
    const o = await saveThing(io, "person", d.id, d.rev, personDoc(d), (attempt, ms) => say(`The store is busy. Trying again in ${ms} ms (try ${attempt + 1}).`, "warn"));
    if ((o.kind === "saved" || o.kind === "stale") && o.state) await take(o.state);
    if (o.kind === "saved") {
      d.id = o.id;
      d.rev = o.rev;
      S.dirty = false;
      history.replaceState(null, "", `?id=${o.id}`);
    }
    if (o.kind === "stale") rebase(d, S.state, (s) => s.people);
    say(saveText(o, d.id === null ? "the person" : `person ${d.id}`), o.kind === "saved" ? "well" : o.kind === "stale" ? "warn" : "bad");
    drawList();
    drawEditor();
  } finally {
    S.busy = false;
    drawFaults();
  }
}

async function retire(): Promise<void> {
  const d = S.draft, st = S.state;
  if (!d || d.id === null || !st || S.busy) return;
  const retired = !st.people.find((p) => p.id === d.id)?.retired;
  S.busy = true;
  try {
    const o = await retireThing(io, "person", d.id, retired, st.revision);
    if ((o.kind === "retired" || o.kind === "stale") && o.state) await take(o.state);
    say(o.kind === "retired" ? (retired ? `Retired person ${d.id}. Whoever plays it now keeps playing it.` : `Person ${d.id} is back on the pick lists.`) : saveText(o, `person ${d.id}`), o.kind === "retired" ? "well" : "bad");
    drawList();
    drawEditor();
  } finally {
    S.busy = false;
    drawFaults();
  }
}

const sure = (what: string): boolean => !S.dirty || confirm(what);

document.addEventListener("click", (ev) => {
  const t = (ev.target as HTMLElement).closest<HTMLButtonElement>("button");
  if (!t || t.disabled || !S.state) return;
  const d = S.draft, data = t.dataset, st = S.state;
  if (t.id === "new-person") {
    if (sure("Start a new person? The draft goes.")) open(newPerson(st, random()));
    say("A new person. Name them, draw them again until they look right, and save.");
  } else if (data.open) {
    const l = st.people.find((p) => p.id === Number(data.open));
    if (l && sure("Open another person? The draft goes.")) open(draftOf(l));
  } else if (data.reroll && d) {
    rerollPart(d.look, data.reroll as PartName, random(), st, S.book);
    edited();
  } else if (t.id === "draw-again" && d) {
    drawAgain(d.look, random(), st, S.book);
    edited();
  } else if (t.id === "back-to-drawn" && d) {
    backToDrawn(d);
    edited();
  } else if (data.handPick && d) {
    setByHand(d, data.handPick as HandField, Number(data.value), st, S.book);
    edited();
  } else if (data.well && d?.dress.kind === "wardrobe") {
    const [slot, k] = data.well.split(":").map(Number);
    S.well = { slot: slot!, k: k! };
    drawDress();
  } else if (data.colour !== undefined && d?.dress.kind === "wardrobe" && S.well) {
    const w = d.dress.slots[S.well.slot];
    if (w) {
      const dye = [...w.dye] as [number, number, number];
      dye[S.well.k] = Number(data.colour);
      d.dress.slots[S.well.slot] = { ...w, dye };
      if (S.well.k < 2) S.well = { slot: S.well.slot, k: S.well.k + 1 };
      edited();
    }
  } else if (t.id === "save") void save().catch(failed);
  else if (t.id === "retire") void retire().catch(failed);
  else if (t.id === "close") {
    if (sure("Close the draft? What is not saved goes.")) open(null);
  } else if (t.id === "bind" && d?.id) {
    const key = $<HTMLSelectElement>("role").value, r = S.cast?.roles.find((x) => x.key === key);
    void castAct(roleOp(key, d.id), `${d.name} plays the ${r ? `${r.scene} ${r.role}` : key} when the role is free.`).catch(failed);
  } else if (data.letgo) {
    const r = S.cast?.roles.find((x) => x.key === data.letgo);
    void castAct(roleOp(data.letgo, null), `Let go of the ${r ? `${r.scene} ${r.role}` : data.letgo}: anyone of its kinds plays it now.`).catch(failed);
  }
  else if (data.feature) void castAct(featureOp(data.feature), `Featured ${data.feature}: the body keeps its look.`).catch(failed);
  else if (t.id === "stage-picture") {
    if (!stage.ready) return void ($("stage-note").textContent = "The person is not drawn yet.");
    void stage.picture(720, 900).then((png) => {
      const link = document.createElement("a");
      link.href = URL.createObjectURL(png);
      link.download = `person-${(d?.name || "draft").replace(/[^A-Za-z0-9]+/g, "-").toLowerCase()}.png`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 10000);
    });
  }
});

function changed(t: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, final: boolean): void {
  const d = S.draft, st = S.state;
  if (t.id === "pose" || t.id === "framing") return soon();
  if (t.id === "world") {
    S.castApi = t.value;
    return void readCast().catch(failed);
  }
  if (!d || !st) return;
  if (t.id === "name") {
    d.name = t.value;
    return edited(false);
  }
  if (t.id === "notes") {
    d.notes = t.value;
    return edited(false);
  }
  if (t.id === "population" && final) {
    choosePopulation(d, refOfKey(t.value), st);
    return edited();
  }
  if (t.id === "seed" && final && d.look.kind === "seed") {
    const v = Number(t.value);
    if (Number.isInteger(v) && v >= 0 && v <= 0xffffffff) d.look.seed = v;
    return edited();
  }
  const hand = (t as HTMLElement).dataset.hand as HandField | undefined;
  if (hand) {
    setByHand(d, hand, Number(t.value), st, S.book);
    const out = t.nextElementSibling;
    if (out?.tagName === "OUTPUT") out.textContent = String(Math.round(Number(t.value) * 100));
    // A slider is redrawn only once it is let go, so it is not taken from under the hand.
    if (final) (t as HTMLElement).blur();
    return edited(final);
  }
  if (t.type === "checkbox" && (t as HTMLElement).dataset.lock) {
    setLock(d.look, (t as HTMLElement).dataset.lock as PartName, (t as HTMLInputElement).checked);
    return edited();
  }
  if (t.type === "radio" && t.name === "dress" && final) {
    const kind = t.value;
    if (kind === "role") d.dress = { kind: "role" };
    else if (kind === "outfit") {
      const first = st.outfits.find((o) => !o.retired);
      if (!first) {
        say("The store has no outfit yet.", "warn");
        return drawDress();
      }
      d.dress = { kind: "outfit", outfit: first.id };
    } else d.dress = { kind: "wardrobe", slots: emptyWardrobe() };
    S.well = null;
    return edited();
  }
  if (t.id === "outfit" && d.dress.kind === "outfit") {
    d.dress = { kind: "outfit", outfit: Number(t.value) };
    return edited();
  }
  const slotG = (t as HTMLElement).dataset.slotGarment, slotE = (t as HTMLElement).dataset.slotEdition;
  if (d.dress.kind === "wardrobe" && (slotG !== undefined || slotE !== undefined)) {
    const i = Number(slotG ?? slotE), w = d.dress.slots[i] ?? null;
    if (slotG !== undefined) d.dress.slots[i] = t.value ? { garment: t.value, edition: 0, dye: [0, 0, 0] } : null;
    else if (w) d.dress.slots[i] = { ...w, edition: Number(t.value) };
    if (S.well?.slot === i && !d.dress.slots[i]) S.well = null;
    return edited();
  }
}

document.addEventListener("input", (e) => changed(e.target as HTMLInputElement, false));
document.addEventListener("change", (e) => changed(e.target as HTMLInputElement, true));
addEventListener("beforeunload", (e) => {
  if (S.dirty) e.preventDefault();
});

$("pose").innerHTML = STAGE_POSES.map((p) => `<option value="${p}">${POSE_WORDS[p]}</option>`).join("");
$("framing").innerHTML = STAGE_FRAMINGS.map((f) => `<option value="${f}"${f === "three-quarter" ? " selected" : ""}>${FRAMING_WORDS[f]}</option>`).join("");

load().then(async () => {
  const st = S.state!;
  const id = Number(new URLSearchParams(location.search).get("id"));
  const promoted = promotedFrom(location.search), listed = st.people.find((p) => p.id === id);
  if (promoted) {
    open(promoted);
    S.dirty = true;
    say("Promoted from a population's sheet: every part is locked to its seed. Name them and save.");
  } else if (listed) {
    open(draftOf(listed));
    say("");
  } else {
    open(null);
    say("");
  }
  body.loaded = "1";
  await drawWorlds();
}, failed);
