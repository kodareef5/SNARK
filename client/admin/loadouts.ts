import { adminContext } from "./shell.ts";
// The admin's loadouts page: the book of what new survivors wear and carry (server/admin/loadout-routes.ts), changed
// as a draft and saved whole with the revision it was read at. What it shows is made in client/core/admin/loadouts.ts;
// this is the page's wiring.

import type { Survivors } from "../../shared/admin.ts";
import type { Entry, LoadoutBook, LoadoutFault } from "../../shared/loadout/book.ts";
import type { LoadoutCatalog } from "../../shared/loadout/catalog.ts";
import { $, ask } from "./dom.ts";
import {
  ROLES, addEntry, addLoadout, asShown, assignOptions, barHtml, changeEntry, copyLoadout, datalistsHtml, differs, draftFaults, draftOf, faultAt, fieldChange, knownOf, listHtml, loadoutHtml,
  cannotHand, fill, moveEntry, parseBook, picked, removeEntry, removeLoadout, renameLoadout, setAssign, setLoadout, survivorOptions, withServer, type Known, type Pickable, type Role,
} from "../core/admin/loadouts.ts";

interface BookWire {
  revision: number;
  builtin: boolean;
  kept: boolean;
  book: LoadoutBook;
  warnings: LoadoutFault[];
}

/** The page's state: the book in force as read, the draft and its faults, and the revision a save lost to. */
const S = {
  wire: null as BookWire | null,
  known: null as Known | null,
  draft: null as LoadoutBook | null,
  faults: [] as LoadoutFault[],
  selected: "",
  conflict: -1,
  survivors: [] as Pickable[],
};

// What a field's change says is written as the page is next drawn: a line come or gone sooner moves the button pressed.
let toSay: [text: string, kind: string] | null = null;
const say = (text: string, kind = "dim"): void => {
  toSay = null;
  $("msg").textContent = text;
  $("msg").className = kind;
};
const failed = (err: unknown): void => say(err instanceof Error ? err.message : String(err), "bad");

async function post(what: string, body: unknown): Promise<{ status: number; answer: Record<string, unknown> }> {
  const r = await fetch((await adminContext()).api(`loadouts/${what}`), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, answer: (await r.json().catch(() => ({}))) as Record<string, unknown> };
}

/** What names the field in hand, so that it is in hand again after the page is drawn anew. */
function fieldInHand(): string {
  const a = document.activeElement as HTMLElement | null;
  if (!a || a === document.body) return "";
  if (a.dataset.field) return `tr[data-entry="${a.closest<HTMLElement>("tr")?.dataset.entry ?? ""}"] [data-field="${a.dataset.field}"]`;
  if (a.dataset.head) return `[data-head="${a.dataset.head}"]`;
  return a.id === "" ? "" : `#${a.id}`;
}

/** What handing out and filling may do now, and why not. */
function hand(): void {
  const { wire, draft } = S;
  if (!wire || !draft) return;
  const who = survivor();
  const why = cannotHand(who, asShown(wire.book, draft, S.selected));
  $<HTMLButtonElement>("apply").disabled = why !== "" || S.selected === "";
  document.querySelector<HTMLButtonElement>('[data-do="capture"]')!.disabled = !who || S.selected === "";
  $("hand-note").textContent = why;
}

function draw(): void {
  const { wire, draft, known } = S;
  if (!wire || !draft || !known) return;
  due = false;
  if (toSay) say(...toSay);
  if (!draft.loadouts.some((l) => l.id === S.selected)) S.selected = draft.loadouts[0]?.id ?? "";
  // The loadout shown is in the address, so it can be linked to.
  if (location.hash !== `#${S.selected}`) history.replaceState(null, "", `#${S.selected}`);
  $("world").textContent = `revision ${wire.revision}${wire.builtin ? ", the built-in loadouts" : ""}${wire.kept ? "" : " · this world has no save, so an edit lasts until it stops"}`;
  // What is typed in the note, and the field in hand, outlive the drawing.
  const note = (document.getElementById("note") as HTMLInputElement | null)?.value ?? "";
  const held = fieldInHand();
  $("bar").innerHTML = barHtml(wire.revision, differs(wire.book, draft), S.faults, S.conflict);
  const again = document.getElementById("note") as HTMLInputElement | null;
  if (again) again.value = note;
  for (const role of ROLES) {
    const box = $<HTMLSelectElement>(`assign-${role}`);
    box.innerHTML = assignOptions(draft, role);
    box.className = faultAt(S.faults, `assign.${role}`).length > 0 ? "wrong" : "";
  }
  $("list").innerHTML = listHtml(draft, S.selected, S.faults);
  $("loadout").innerHTML = loadoutHtml(draft, draft.loadouts.findIndex((l) => l.id === S.selected), known, S.faults);
  hand();
  if (held !== "") document.querySelector<HTMLElement>(held)?.focus();
}

// A field left for a button is changed as the button is pressed: the page is drawn after the click, so the button is
// still there to take it.
let due = false;
let pressed = false;
function later(): void {
  due = true;
  setTimeout(() => {
    if (due && !pressed) draw();
  }, 0);
}
const released = (): void => {
  pressed = false;
  if (due) later();
};
// A button, a tick and a label wait for their click. A select does not: its list takes the mouse's release for itself.
const waits = (at: EventTarget | null): boolean => at instanceof Element && at.closest("select") === null && at.closest("button, label, input[type=checkbox]") !== null;
addEventListener("mousedown", (e) => void (pressed = waits(e.target)), true);
addEventListener("mouseup", released, true);
addEventListener("blur", released);

/** The draft changed: it is checked again and drawn, now or once the hand is off the mouse. */
function changed(now = false): void {
  S.faults = draftFaults(S.draft!, S.known!);
  if (now) draw();
  else later();
}

/** Reads the book in force, and the catalogue the first time, and begins a draft of it. */
async function start(said = "", kind = "dim"): Promise<void> {
  const wire = (await (await ask("loadouts/book.json")).json()) as BookWire;
  if (!S.known) {
    S.known = knownOf((await (await ask("loadouts/catalog.json")).json()) as LoadoutCatalog);
    document.body.insertAdjacentHTML("beforeend", datalistsHtml(S.known));
  }
  S.wire = wire;
  S.draft = draftOf(wire.book);
  S.conflict = -1;
  // The server's warnings are of the book as it is in force: they stand until the draft is changed.
  S.faults = withServer(draftFaults(S.draft, S.known), wire.warnings);
  say(said, kind);
  draw();
}

/** Saves the draft over revision `expected`, or puts the built-ins back, and reads the book again; or says why not. */
async function save(what: "book" | "reset", expected: number): Promise<void> {
  const note = (document.getElementById("note") as HTMLInputElement | null)?.value ?? "";
  const { status, answer } = await post(what, what === "book" ? { book: S.draft, expected, note } : { expected });
  if (status === 200) {
    const warned = ((answer.warnings as LoadoutFault[] | undefined) ?? []).length;
    const made = what === "book" ? `Saved as revision ${String(answer.revision)}` : `The built-in loadouts are back, as revision ${String(answer.revision)}`;
    await start(warned === 0 ? `${made}.` : `${made}, with ${warned === 1 ? "1 warning" : `${warned} warnings`}, shown where each is.`, warned === 0 ? "well" : "warn");
  } else if (status === 409) {
    S.conflict = Number(answer.revision);
    say("Not saved: the book changed. Another editor saved first.", "warn");
    draw();
  } else if (status === 422) {
    S.faults = withServer(S.faults.filter((f) => f.warn === true), (answer.faults as LoadoutFault[] | undefined) ?? []);
    say("Not saved: the book has faults. Each is shown at its entry.", "bad");
    draw();
  } else say(`Not saved: ${String(answer.error ?? status)}`, "bad");
}

/** The survivor the picker shows, by its number. */
const survivor = (): Pickable | undefined => S.survivors.find((s) => String(s.pid) === $<HTMLSelectElement>("survivor").value);

/** A button of the page. */
async function act(at: HTMLElement): Promise<void> {
  const { wire, draft: d } = S;
  if (!wire || !d) return;
  const what = at.dataset.do!;
  const index = Number(at.dataset.entry);
  if (what === "new" || what === "copy") {
    const id = what === "new" ? addLoadout(d) : copyLoadout(d, S.selected);
    if (id === null) return say("The book holds no more loadouts.", "warn");
    S.selected = id;
  } else if (what === "remove") {
    const why = removeLoadout(d, S.selected);
    if (why !== "") return say(why, "warn");
  } else if (what === "item" || what === "tame") addEntry(d, S.selected, what);
  else if (what === "up" || what === "down") moveEntry(d, S.selected, index, what === "up" ? -1 : 1);
  else if (what === "del") removeEntry(d, S.selected, index);
  else if (what === "discard") [S.draft, S.conflict] = [draftOf(wire.book), -1];
  else if (what === "save") return save("book", wire.revision);
  else if (what === "over") return save("book", S.conflict);
  else if (what === "theirs") return start("Read again.");
  else if (what === "reset") return confirm("Put the built-in loadouts back, as the next revision? Every loadout made here goes.") ? save("reset", wire.revision) : undefined;
  else if (what === "import") return $<HTMLInputElement>("file").click();
  else if (what === "export") {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([`${JSON.stringify(d, null, 1)}\n`], { type: "application/json" }));
    a.download = `loadouts-r${wire.revision}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    return;
  } else if (what === "apply") {
    // Done to the world now, by the book in force, as the console's `loadout` does it.
    const who = survivor();
    if (!who) return;
    // A press straight from a field just changed comes before the button is drawn disabled.
    const why = cannotHand(who, asShown(wire.book, d, S.selected));
    if (why !== "") return say(why, "warn"), hand();
    const clear = $<HTMLInputElement>("clear").checked;
    if (clear && !confirm(`Clear everything ${who.name} holds, then hand out ${S.selected}?`)) return;
    const { status, answer } = await post("apply", { loadout: S.selected, pid: who.pid, clear });
    return say(String(answer.said ?? answer.error ?? status), status === 200 ? "dim" : "bad");
  } else if (what === "capture") {
    const who = survivor();
    if (!who) return;
    // The loadout asked about is the one filled, though another is picked before the answer comes.
    const into = S.selected;
    const now = d.loadouts.find((l) => l.id === into)?.entries.length ?? 0;
    if (now > 0 && !confirm(`Put what ${who.name} wears and carries in place of the ${now === 1 ? "entry" : `${now} entries`} of ${into}?`)) return;
    const r = await fetch((await adminContext()).api(`loadouts/capture.json?pid=${who.pid}`), { cache: "no-store" });
    const got = (await r.json().catch(() => ({}))) as { survivor?: string; entries?: Entry[]; cut?: number; error?: string };
    if (r.status !== 200 || !got.entries) return say(got.error ?? `The server answered ${r.status}.`, "warn");
    const why = fill(d, S.draft!, into, got.entries);
    if (why !== "") return say(why, "warn");
    say(`Filled ${into} from ${got.survivor ?? who.name}: ${got.entries.length === 1 ? "1 entry" : `${got.entries.length} entries`}${got.cut ? `, and ${got.cut} more that a loadout has no room for are left out` : ""}. Not saved yet.`);
  } else return;
  changed(true);
}

document.addEventListener("click", (e) => {
  const at = (e.target as HTMLElement).closest<HTMLElement>("[data-do],[data-pick]");
  if (!at) return;
  if (at.dataset.pick !== undefined) {
    S.selected = at.dataset.pick;
    return draw();
  }
  void act(at).catch(failed);
});

document.addEventListener("change", (e) => {
  const at = e.target as HTMLInputElement | HTMLSelectElement;
  const { wire, draft: d, known } = S;
  if (!wire || !d || !known) return;
  const ticked = at instanceof HTMLInputElement && at.type === "checkbox";
  if (at.id === "file") {
    const file = (at as HTMLInputElement).files?.[0];
    if (!file) return;
    // A book from a file becomes the draft, to be looked at and then saved or discarded.
    void file.text().then((text) => {
      at.value = "";
      const made = parseBook(text);
      if ("error" in made) return say(`Not read: ${made.error}`, "bad");
      made.book.revision = wire.revision;
      S.draft = made.book;
      say("Read from the file. Not saved yet.");
      changed(true);
    }, failed);
    return;
  }
  // Who is picked decides what may be handed out.
  if (at.id === "survivor") return hand();
  if (at.id === "assign-player" || at.id === "assign-admin") setAssign(d, at.id.slice("assign-".length) as Role, at.value);
  else if (at.dataset.head === "id") {
    const why = renameLoadout(d, S.selected, at.value.trim());
    if (why === "") S.selected = at.value.trim();
    toSay = [why, "warn"];
  } else if (at.dataset.head === "respawn") setLoadout(d, S.selected, { respawn: (at as HTMLInputElement).checked });
  else if (at.dataset.head === "label" || at.dataset.head === "note") setLoadout(d, S.selected, { [at.dataset.head]: at.value.trim() });
  else if (at.dataset.field) {
    const field = at.dataset.field;
    const raw = ticked ? (at as HTMLInputElement).checked : field === "item" || field === "tame" ? picked(known, at.value, field) || at.value : at.value;
    const change = fieldChange(field, raw);
    if (change) changeEntry(d, S.selected, Number(at.closest<HTMLElement>("tr")?.dataset.entry), change, known);
    toSay = [change ? "" : "That is not what this field takes.", "warn"];
  } else return;
  changed();
});

/** The survivors of the world, for the picker: read again now and then, as they come and go. */
async function people(): Promise<void> {
  const got = (await (await ask("survivors.json")).json()) as Survivors;
  S.survivors = got.survivors.map((s) => ({ pid: s.pid, name: s.name, online: s.online }));
  const box = $<HTMLSelectElement>("survivor");
  if (document.activeElement !== box) box.innerHTML = survivorOptions(S.survivors, box.value);
  hand();
}

addEventListener("beforeunload", (e) => {
  if (S.wire && S.draft && differs(S.wire.book, S.draft).length > 0) e.preventDefault();
});
S.selected = decodeURIComponent(location.hash.slice(1));
start().then(people).catch(failed);
setInterval(() => void people().catch(() => {}), 10000);
