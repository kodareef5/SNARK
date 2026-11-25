// A world's Permissions page: groups, members and staff passwords, chat formats and settings, imports from ArkApi, and
// the cluster's history of changes, over the world's own admin address. What it shows and sends is made in
// client/core/admin/permissions.ts; this is the page's wiring. No staff password ever reaches it: each survivor claims
// their own in game. While it is open and no field is in hand it asks every ten seconds whether anything changed.

import { adminContext } from "./shell.ts";
import {
  addGroupPost, addMemberPost, blankChatForm, blankTag, chatBlockOf, chatFormOf, chatGroupHtml, chatPost, clearPasswordPost, coloured, editAfter, editOf, everyMapOf, grantPost,
  groupsHtml, headingOf, hexInk, historyHtml, IMPORT_START, importAnswered, importApplyPost, importAsked, importEdited, importHtml, importPost, defineWhy,
  manageWhy, meText, readFault, memberGroupOptions, memberRows, memberRowsHtml, passwordRows,
  passwordRowsHtml, permissionListHtml, rankOptions, rankPost, rankWhy, removeGroupPost, removeMemberPost, revokePost, sampleRuns, settingsFormOf, settingsHtml, settingsPost,
  settingsTextOf, survivorName, tagRuns, whoOptions, type Built, type ChatForm, type Edit, type Fault, type MemberRow, type SettingsForm,
} from "../core/admin/permissions.ts";
import { esc } from "../core/admin/format.ts";
import { base64 } from "../core/admin/screens.ts";
import type { TextRun } from "../../shared/net/chat.ts";
import type { PartKey } from "../../shared/permissions/chat.ts";
import type { HistoryRow, MemberKind } from "../../shared/permissions/model.ts";
import {
  PERMISSIONS_API, PERMISSIONS_HISTORY, PERMISSIONS_REFRESH_MS, PERMISSIONS_STATE, WAL_MISSING, type ImportKind, type PermissionsAnswer, type PermissionsHistory, type PermissionsPost,
  type PermissionsSame, type PermissionsState,
} from "../../shared/permissions/page.ts";
import { RANK_NAMES } from "../../shared/ranks.ts";

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const TABS = ["groups", "members", "chat", "import", "history"] as const;

/** The page's state: the store as last read, the rows drawn from it, and the drafts that outlive a read. */
const S = {
  state: null as PermissionsState | null,
  rows: [] as MemberRow[],
  /** Chat forms being edited, by group name in lower case; a draft of null is to have no block. */
  chat: new Map<string, Edit<ChatForm | null>>(),
  settings: null as SettingsForm | null,
  settingsChanged: false,
  /** The chat settings' text the form began from, and theirs once someone saved over it meanwhile. */
  settingsFrom: "",
  settingsTheirs: null as string | null,
  /** Ranks someone else changed while this admin chose one, by group name in lower case. */
  ranks: new Map<string, Edit<number>>(),
  /** The import's input and requests as counted, and the check Apply sends, of the input it was made for. */
  imports: IMPORT_START,
  history: [] as HistoryRow[],
  historyMore: false,
  loading: false,
  /** The last read was refused a sign-in: the page stops asking until it is read again by hand. */
  signedOut: false,
};

/** An address of this world's admin API, as the shell resolves it under the world's own path. */
async function api(path: string): Promise<string> {
  return (await adminContext()).api(path.slice("/admin/".length));
}

function say(text: string, kind = "dim"): void {
  $("msg").textContent = text;
  $("msg").className = kind;
}
const failed = (err: unknown): void => say(err instanceof Error ? err.message : String(err), "bad");

let deferred = false;
const painted = new WeakMap<HTMLElement, string>();
/** Writes `html` into `el` when it changed, but not under a field in hand: the page is drawn again once it is let go. */
function paint(el: HTMLElement, html: string, force = false): void {
  if (!force && painted.get(el) === html) return;
  const held = document.activeElement;
  if (held && el.contains(held) && /^(INPUT|SELECT|TEXTAREA)$/.test(held.tagName)) return void (deferred = true);
  el.innerHTML = html;
  painted.set(el, html);
}
// A button pressed as a field is let go is not drawn away under the mouse: the page waits for its click.
let pressed = false;
function drawDeferred(): void {
  if (!deferred || pressed) return;
  deferred = false;
  draw();
}
addEventListener("mousedown", (e) => void (pressed = e.target instanceof Element && e.target.closest("button") !== null), true);
addEventListener("mouseup", () => {
  pressed = false;
  setTimeout(drawDeferred);
}, true);
document.addEventListener("focusout", () => setTimeout(drawDeferred));

/** Sets a control off with the reason as its title, or on. */
function allow(el: HTMLElement & { disabled: boolean }, why: string): void {
  el.disabled = why !== "";
  el.title = why;
}

// ---- Drawing ----

function showTab(tab: string): void {
  const at = (TABS as readonly string[]).includes(tab) ? tab : "groups";
  for (const t of TABS) $(`tab-${t}`).hidden = t !== at;
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-tab]")) {
    b.classList.toggle("on", b.dataset.tab === at);
    b.setAttribute("aria-selected", String(b.dataset.tab === at));
  }
  if (location.hash !== `#${at}`) history.replaceState(null, "", `#${at}`);
}

/** Fills an element with coloured runs, each set as text. */
function runsInto(el: Element, runs: readonly TextRun[]): void {
  el.replaceChildren(...runs.map((r) => {
    const span = document.createElement("span");
    span.textContent = r.text;
    if (r.ink !== undefined) span.style.color = `#${(r.ink & 0xffffff).toString(16).padStart(6, "0")}`;
    return span;
  }));
}

const savedChat = (name: string): string => S.state?.groups.find((g) => g.name.toLowerCase() === name.toLowerCase())?.chat ?? "";

const chatForm = (name: string): ChatForm | null => {
  const key = name.toLowerCase();
  if (S.chat.has(key)) return S.chat.get(key)!.draft;
  return chatFormOf(savedChat(name)).form;
};

function drawSamples(): void {
  const state = S.state;
  if (!state || !S.settings) return;
  for (const el of document.querySelectorAll<HTMLElement>("[data-sample]")) runsInto(el, sampleRuns(state, el.dataset.sample!, chatForm(el.dataset.sample!), S.settings));
  for (const el of document.querySelectorAll<HTMLElement>("[data-tag-sample]")) runsInto(el, tagRuns(S.settings.tags[Number(el.dataset.tagSample)]?.text ?? ""));
}

/** Writes each fault beside its field in `root`, as text. */
function showFaults(root: Element, faults: readonly Fault[]): void {
  for (const el of root.querySelectorAll<HTMLElement>("[data-fault]")) {
    el.textContent = faults.filter((f) => f.at === el.dataset.fault).map((f) => f.text).join(" ");
  }
}

function chatFaults(name: string): Fault[] {
  const form = chatForm(name);
  if (!form) return [];
  const read = S.chat.has(name.toLowerCase()) ? [] : chatFormOf(savedChat(name)).faults;
  return [...read.map((text) => ({ at: "", text: `As saved: ${text}` })), ...chatBlockOf(form).faults];
}

function drawChat(): void {
  const state = S.state!;
  // Typing changes the fields and not the HTML they were drawn from, so these are always drawn anew.
  const theirs = (name: string): string | null => {
    const t = S.chat.get(name.toLowerCase())?.theirs;
    return t === null || t === undefined ? null : String(t);
  };
  paint($("chat-groups"), state.groups.map((g) => chatGroupHtml(state, g, chatForm(g.name), chatFaults(g.name), theirs(g.name))).join(""), true);
  paint($("chat-settings"), settingsHtml(state, S.settings!, settingsTextOf(S.settings!).faults, S.settingsTheirs), true);
  drawSamples();
}

function draw(): void {
  const state = S.state;
  if (!state) return;
  const manage = manageWhy(state);
  const define = defineWhy(state);
  const heading = headingOf(state);
  $("title").textContent = heading.title;
  $("scope").textContent = heading.scope;
  $("me").textContent = meText(state);
  $("unsaved").hidden = state.saved;
  paint($("groups"), groupsHtml(state, S.ranks));
  paint($("permission-list"), permissionListHtml(state));
  paint($("group-list"), state.groups.map((g) => `<option value="${esc(g.name)}">`).join(""));
  paint($("world-list"), state.worlds.map((w) => `<option value="${esc(w.name)}">`).join(""));
  const rank = $<HTMLSelectElement>("group-rank");
  paint(rank, rankOptions(Number(rank.value || 0), (r) => define || rankWhy(state, r)));
  for (const id of ["group-name", "add-group"]) allow($<HTMLInputElement>(id), define);
  for (const id of ["member-kind", "member-who", "member-group", "member-hours", "member-delay", "add-member", "import-kind", "import-file", "import-wal", "import-text", "import-check"]) {
    allow($<HTMLInputElement>(id), manage);
  }
  const group = $<HTMLSelectElement>("member-group");
  paint(group, memberGroupOptions(state, group.value));
  paint($("who-list"), whoOptions(state, $<HTMLSelectElement>("member-kind").value as MemberKind));
  drawEvery(false);
  S.rows = memberRows(state, Date.now());
  paint($("members"), memberRowsHtml(S.rows));
  paint($("passwords"), passwordRowsHtml(passwordRows(state)));
  if (!S.settingsChanged) {
    const read = settingsFormOf(state.document);
    S.settings = read.form;
    S.settingsFrom = state.document;
    $("settings-read").textContent = read.faults.length ? `As saved: ${read.faults.join(" ")}` : "";
  }
  drawChat();
  allow($<HTMLButtonElement>("import-apply"), define || (S.imports.checked ? "" : "Check it first."));
}

/** The Every map box: offered unticked for a staff group to a cluster admin, else a word on where the membership holds. */
function drawEvery(reset: boolean): void {
  const state = S.state;
  if (!state) return;
  const every = everyMapOf(state, $<HTMLSelectElement>("member-group").value);
  $("member-every-label").hidden = !every.offer;
  $("member-every-note").textContent = every.note;
  if (reset || !every.offer) $<HTMLInputElement>("member-every").checked = false;
}

// ---- Reading and sending ----

/** Reads the state again. With `ifChanged`, the server answers "the same" while nothing it is made from moved. */
async function load(ifChanged = false): Promise<void> {
  if (S.loading) return;
  S.loading = true;
  try {
    const key = ifChanged && S.state ? `?key=${encodeURIComponent(S.state.key)}` : "";
    const r = await fetch(`${await api(PERMISSIONS_STATE)}${key}`, { cache: "no-store" });
    S.signedOut = r.status === 401;
    if (!r.ok) throw new Error(readFault(r.status, await r.text()));
    const got = (await r.json()) as PermissionsState | PermissionsSame;
    if ($("msg").textContent === "Loading…") say("");
    $("reload").hidden = true;
    if ("same" in got) return;
    S.state = got;
    draw();
  } catch (e) {
    failed(e);
    $("reload").hidden = false;
  } finally {
    S.loading = false;
  }
}

/** Sends one change, says what came of it, and reads the store again. */
async function send(post: PermissionsPost, done: string): Promise<PermissionsAnswer> {
  const r = await fetch(await api(PERMISSIONS_API), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(post) });
  const answer = (await r.json().catch(() => ({}))) as Partial<PermissionsAnswer>;
  const ok = r.ok && answer.ok === true;
  if (ok) say(done, "well");
  else say(answer.why || `The server answered ${r.status}.`, r.status === 409 ? "warn" : "bad");
  await load();
  if (!$("tab-history").hidden) await loadHistory(false);
  return { ...answer, ok, why: answer.why ?? "" };
}

/** The history's newest page, put before what is held, or with `older` the page after the oldest held. */
async function loadHistory(older: boolean): Promise<void> {
  const before = older ? S.history.at(-1)?.seq ?? 0 : 0;
  try {
    const r = await fetch(`${await api(PERMISSIONS_HISTORY)}${before > 0 ? `?before=${before}` : ""}`, { cache: "no-store" });
    if (!r.ok) throw new Error(readFault(r.status, await r.text()));
    const got = (await r.json()) as PermissionsHistory;
    if (older) [S.history, S.historyMore] = [[...S.history, ...got.rows], got.more];
    else {
      const top = S.history[0]?.seq ?? 0;
      const fresh = got.rows.filter((row) => row.seq > top);
      // More is new than one page holds: the newest page alone, with the rest a press away.
      const gap = fresh.length === got.rows.length && got.more && S.history.length > 0;
      [S.history, S.historyMore] = gap || S.history.length === 0 ? [got.rows, got.more] : [[...fresh, ...S.history], S.historyMore];
    }
    if (S.state) paint($("history"), historyHtml(S.state, S.history));
    $("history-older").hidden = !S.historyMore;
  } catch (e) {
    failed(e);
  }
}

/** A field in hand, which a refresh would draw away under the typing. */
const editing = (): boolean => {
  const held = document.activeElement;
  return held !== null && /^(INPUT|SELECT|TEXTAREA)$/.test(held.tagName);
};

/** While the page is seen and no field is in hand, asks whether anything changed. A draft is kept whatever comes. */
async function refresh(): Promise<void> {
  if (document.visibilityState === "visible" && !editing() && S.state && !S.signedOut) {
    await load(true);
    if (!$("tab-history").hidden) await loadHistory(false);
  }
  setTimeout(() => void refresh(), PERMISSIONS_REFRESH_MS);
}

/** Sends a built change, or says why it was not sent. */
async function sendBuilt(b: Built, done: string): Promise<PermissionsAnswer | null> {
  if (!b.post) {
    say(b.why, "warn");
    return null;
  }
  return send(b.post, done);
}

// ---- Acts ----

/** The text an import sends: the file as base64, or what was pasted; and an ArkApi database's -wal file as base64, or "". */
async function importText(kind: ImportKind): Promise<{ text: string; wal: string }> {
  if (kind !== "arkapi") return { text: $<HTMLTextAreaElement>("import-text").value, wal: "" };
  const read = async (id: string): Promise<string> => {
    const file = $<HTMLInputElement>(id).files?.[0];
    return file ? base64(new Uint8Array(await file.arrayBuffer())) : "";
  };
  return { text: await read("import-file"), wal: await read("import-wal") };
}

/** Saves a group's chat draft over the value it began from. */
async function saveChat(group: string, chat: string, done: string): Promise<void> {
  const key = group.toLowerCase();
  const edit = S.chat.get(key) ?? editOf<ChatForm | null>(savedChat(group), chatForm(group));
  const answer = await sendBuilt(chatPost(S.state!, group, chat, String(edit.from)), done);
  if (!answer) return;
  const after = editAfter(edit, answer);
  if (after === null) S.chat.delete(key);
  else if (S.chat.has(key) || after.theirs !== null) S.chat.set(key, after);
  drawChat();
}

/** Saves the chat settings' draft over the text it began from. */
async function saveSettings(): Promise<void> {
  const made = settingsTextOf(S.settings!);
  if (made.faults.length > 0) return say("Not sent: the chat settings have faults. Each is shown beside its field.", "warn");
  const b = settingsPost(S.state!, made.text, S.settingsFrom);
  if (!b.post) return say(b.why, "warn");
  const draft = S.settings!;
  const after = editAfter(editOf(S.settingsFrom, draft), await send(b.post, "Saved the chat settings."));
  if (after === null) [S.settingsChanged, S.settingsTheirs] = [false, null];
  else [S.settings, S.settingsChanged, S.settingsFrom, S.settingsTheirs] = [draft, true, String(after.from), after.theirs === null ? S.settingsTheirs : String(after.theirs)];
  draw();
}

/** Sends a rank chosen for a group over the rank it began from. */
async function saveRank(group: string, rank: number, from: number, label: string): Promise<void> {
  const key = group.toLowerCase();
  const answer = await sendBuilt(rankPost(S.state!, group, rank, from), `${group} is of the ${label} rank now.`);
  const after = answer ? editAfter(editOf(from, rank), answer) : null;
  if (after && after.theirs !== null) S.ranks.set(key, after);
  else S.ranks.delete(key);
  paint($("groups"), groupsHtml(S.state!, S.ranks), true);
}

/** The import's input changed: an answer to a request sent before approves nothing. */
function forgetCheck(): void {
  S.imports = importEdited(S.imports);
  $("import-out").innerHTML = "";
  if (S.state) allow($<HTMLButtonElement>("import-apply"), defineWhy(S.state) || "Check it first.");
}

async function act(at: HTMLElement): Promise<void> {
  const state = S.state;
  if (!state) return;
  const what = at.dataset.act ?? at.id;
  const group = at.dataset.group ?? "";
  const key = group.toLowerCase();
  switch (what) {
    case "add-group": {
      const name = $<HTMLInputElement>("group-name");
      const done = await sendBuilt(addGroupPost(state, name.value, Number($<HTMLSelectElement>("group-rank").value)), `Added the group ${name.value.trim()}.`);
      if (done?.ok) name.value = "";
      return;
    }
    case "remove-group": {
      const n = state.members.filter((m) => m.group.toLowerCase() === key).length;
      if (!confirm(`Remove the group ${group}${n ? ` and its ${n === 1 ? "membership" : `${n} memberships`}` : ""}?`)) return;
      await sendBuilt(removeGroupPost(state, group), `Removed the group ${group}.`);
      return;
    }
    case "grant": {
      const field = document.querySelector<HTMLInputElement>(`[data-grant="${CSS.escape(group)}"]`)!;
      const done = await sendBuilt(grantPost(state, group, field.value), `${group} holds ${field.value.trim()} now.`);
      if (done?.ok) field.value = "";
      return;
    }
    case "revoke":
      await sendBuilt(revokePost(state, group, at.dataset.perm!), `${group} no longer holds ${at.dataset.perm}.`);
      return;
    case "add-member": {
      const who = $<HTMLInputElement>("member-who");
      const done = await sendBuilt(addMemberPost(state, {
        kind: $<HTMLSelectElement>("member-kind").value as MemberKind,
        who: who.value,
        group: $<HTMLSelectElement>("member-group").value,
        hours: $<HTMLInputElement>("member-hours").value,
        delay: $<HTMLInputElement>("member-delay").value,
        everyMap: $<HTMLInputElement>("member-every").checked,
      }), `Added ${who.value.trim()} to ${$<HTMLSelectElement>("member-group").value}.`);
      if (done?.ok) who.value = "";
      return;
    }
    case "remove-member": {
      const row = S.rows[Number(at.dataset.row)];
      if (row) await sendBuilt(removeMemberPost(state, row.member), `Took ${row.who} (${row.member.key}) out of ${row.group}.`);
      return;
    }
    case "clear-password": {
      const id = at.dataset.id!;
      if (!confirm(`Clear the password of ${survivorName(state, id) || id}? They lose their staff powers until they claim a new one in game.`)) return;
      await sendBuilt(clearPasswordPost(state, id), "Cleared the password.");
      return;
    }
    case "chat-add":
      S.chat.set(key, editOf(savedChat(group), blankChatForm()));
      return drawChat();
    case "chat-undo":
    case "chat-keep":
      S.chat.delete(key);
      return drawChat();
    case "chat-save":
    case "chat-again": {
      const form = chatForm(group);
      // A draft of no block, someone's saved over: sent again, it takes theirs away.
      if (!form) return S.chat.has(key) ? saveChat(group, "", `${group} has no chat format now.`) : undefined;
      const block = chatBlockOf(form);
      if (block.faults.length > 0) return say("Not sent: the chat format has faults. Each is shown beside its field.", "warn");
      return saveChat(group, block.text, `Saved the chat format of ${group}.`);
    }
    case "chat-remove": {
      if (!confirm(`Remove the chat format of ${group}?`)) return;
      if (!S.chat.has(key)) S.chat.set(key, editOf(savedChat(group), null));
      else S.chat.set(key, { ...S.chat.get(key)!, draft: null });
      return saveChat(group, "", `${group} has no chat format now.`);
    }
    case "rank-again": {
      const edit = S.ranks.get(key);
      if (edit) await saveRank(group, edit.draft, Number(edit.from), RANK_NAMES[edit.draft] ?? "");
      return;
    }
    case "rank-keep":
      S.ranks.delete(key);
      return void paint($("groups"), groupsHtml(state, S.ranks), true);
    case "plain": {
      const block = at.closest<HTMLElement>("[data-chat]")!;
      const name = block.dataset.chat!;
      const form = draftOf(name);
      if (!form) return;
      const part = at.dataset.part as PartKey;
      form.parts[part] = coloured(form.parts[part], -1);
      block.querySelector<HTMLInputElement>(`[data-field="part.${part}"]`)!.value = form.parts[part];
      return chatChanged(block, name);
    }
    case "tag-add":
      S.settings!.tags.push(blankTag());
      S.settingsChanged = true;
      return drawChat();
    case "tag-del":
      S.settings!.tags.splice(Number(at.dataset.tag), 1);
      S.settingsChanged = true;
      return drawChat();
    case "map-add":
      S.settings!.maps.push({ map: "", colour: "#ffffff" });
      S.settingsChanged = true;
      return drawChat();
    case "map-del":
      S.settings!.maps.splice(Number(at.dataset.map), 1);
      S.settingsChanged = true;
      return drawChat();
    case "settings-undo":
    case "settings-keep":
      [S.settingsChanged, S.settingsTheirs] = [false, null];
      return draw();
    case "settings-save":
    case "settings-again":
      return saveSettings();
    case "import-check":
    case "import-apply": {
      const apply = what === "import-apply";
      // Counted before the files are read, so an edit while they are read is seen.
      S.imports = importAsked(S.imports);
      const sent = S.imports;
      const kind = $<HTMLSelectElement>("import-kind").value as ImportKind;
      const input = { kind, ...(await importText(kind)) };
      const b = apply ? importApplyPost(state, S.imports, input) : importPost(state, kind, input.text, false, "", input.wal);
      if (!b.post) return say(b.why, "warn");
      if (apply && !confirm("Make these changes?")) return;
      const answer = await send(b.post, apply ? "Imported." : "Checked. Nothing is changed until Apply.");
      const after = importAnswered(S.imports, sent, input, answer, apply);
      S.imports = after.track;
      allow($<HTMLButtonElement>("import-apply"), defineWhy(S.state ?? state) || (after.track.checked ? "" : "Check it first."));
      if (!after.shown) return say("The import was changed while it was checked. Check it again.", "warn");
      $("import-out").innerHTML = importHtml(answer, apply);
      return;
    }
    case "history-older":
      return loadHistory(true);
    case "reload":
      return load();
  }
}

/** The chat form of a group to change: its draft, begun from what is saved, which it is sent over. */
function draftOf(name: string): ChatForm | null {
  const key = name.toLowerCase();
  if (!S.chat.has(key)) {
    const form = chatForm(name);
    S.chat.set(key, editOf(savedChat(name), form ? structuredClone(form) : null));
  }
  return S.chat.get(key)?.draft ?? null;
}

function chatChanged(block: HTMLElement, name: string): void {
  showFaults(block, chatFaults(name));
  drawSamples();
}

function settingsChanged(): void {
  S.settingsChanged = true;
  showFaults($("chat-settings"), settingsTextOf(S.settings!).faults);
  drawSamples();
}

/** A field of a chat block or of the chat settings was typed in. */
function typed(at: HTMLInputElement): void {
  const block = at.closest<HTMLElement>("[data-chat]");
  if (block) {
    const name = block.dataset.chat!;
    const form = draftOf(name);
    if (!form) return;
    const field = at.dataset.field ?? "";
    if (at.dataset.colour) {
      const part = at.dataset.colour as PartKey;
      form.parts[part] = coloured(form.parts[part], hexInk(at.value));
      block.querySelector<HTMLInputElement>(`[data-field="part.${part}"]`)!.value = form.parts[part];
    } else if (field === "format") form.format = at.value;
    else if (field === "priority") form.priority = at.value;
    else if (field.startsWith("part.")) form.parts[field.slice(5) as PartKey] = at.value;
    else return;
    return chatChanged(block, name);
  }
  const set = at.dataset.set;
  const s = S.settings;
  if (!set || !s) return;
  const tag = s.tags[Number(at.closest<HTMLElement>("[data-tag]")?.dataset.tag)];
  const map = s.maps[Number(at.closest<HTMLElement>("[data-map]")?.dataset.map)];
  if (set === "stack") s.stack = at.checked;
  else if (set === "muted") s.muted = at.value;
  else if (tag && set === "tag.name") tag.name = at.value;
  else if (tag && set === "tag.text") tag.text = at.value;
  else if (tag && set === "tag.priority") tag.priority = at.value;
  else if (tag && set === "tag.off") tag.canBeDisabled = at.checked;
  else if (tag && set === "tag.colour") {
    tag.text = coloured(tag.text, hexInk(at.value));
    at.closest("tr")!.querySelector<HTMLInputElement>('[data-set="tag.text"]')!.value = tag.text;
  } else if (map && set === "map.map") map.map = at.value;
  else if (map && set === "map.colour") map.colour = at.value;
  else return;
  settingsChanged();
}

document.addEventListener("click", (e) => {
  const at = (e.target as HTMLElement).closest("button");
  if (!at || at.disabled) return;
  if (at.dataset.tab) {
    showTab(at.dataset.tab);
    if (at.dataset.tab === "history") void loadHistory(false);
    return;
  }
  void act(at).catch(failed);
});

document.addEventListener("input", (e) => {
  const at = e.target as HTMLElement;
  if (at instanceof HTMLInputElement) typed(at);
  if (at.id === "import-text") forgetCheck();
});

document.addEventListener("change", (e) => {
  const at = e.target as HTMLElement;
  const state = S.state;
  if (!state) return;
  if (at instanceof HTMLSelectElement && at.dataset.act === "rank") {
    const group = at.dataset.group!;
    // A refused change leaves the page's HTML as it was, so the choice is put back by hand; one overtaken shows theirs beside it.
    const back = (): void => void (S.ranks.has(group.toLowerCase()) || (at.value = String(S.state?.groups.find((g) => g.name === group)?.rank ?? at.value)));
    const edit = S.ranks.get(group.toLowerCase());
    const from = edit ? Number(edit.from) : (state.groups.find((g) => g.name === group)?.rank ?? 0);
    void saveRank(group, Number(at.value), from, at.selectedOptions[0]?.textContent ?? "").then(back, (e: unknown) => (back(), failed(e)));
  } else if (at.id === "member-kind") {
    paint($("who-list"), whoOptions(state, $<HTMLSelectElement>("member-kind").value as MemberKind));
    $<HTMLInputElement>("member-who").placeholder = $<HTMLSelectElement>("member-kind").value === "tribe" ? "Tribe name or number" : "Name or 17-digit ID";
  } else if (at.id === "member-group") {
    drawEvery(true);
  } else if (at.id === "import-kind") {
    const pasted = $<HTMLSelectElement>("import-kind").value !== "arkapi";
    $("import-file-bar").hidden = pasted;
    $("import-text").hidden = !pasted;
    forgetCheck();
  } else if (at.id === "import-file" || at.id === "import-wal") forgetCheck();
});

addEventListener("beforeunload", (e) => {
  if (S.settingsChanged || S.chat.size > 0) e.preventDefault();
});

addEventListener("hashchange", () => {
  showTab(location.hash.slice(1));
  if (location.hash === "#history") void loadHistory(false);
});
$("wal-words").textContent = WAL_MISSING;
showTab(location.hash.slice(1));
void load().then(() => {
  if (location.hash === "#history") void loadHistory(false);
  setTimeout(() => void refresh(), PERMISSIONS_REFRESH_MS);
});
