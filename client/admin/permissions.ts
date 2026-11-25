// The cluster's Permissions page: groups, members and staff passwords, chat formats and settings, and imports from
// ArkApi, over /admin/permissions/. What it shows and sends is made in client/core/admin/permissions.ts; this is the
// page's wiring. A new staff password lives only in its box, and is never stored, put in an address or logged.

import "./shell.ts";
import {
  addGroupPost, addMemberPost, blankChatForm, blankTag, chatBlockOf, chatFormOf, chatGroupHtml, chatPost, clearPasswordPost, coloured, grantPost, groupsHtml, hexInk, importHtml,
  importPost, manageWhy, meText, memberGroupOptions, memberRows, memberRowsHtml, passwordPost, passwordRows, passwordRowsHtml, permissionListHtml, rankOptions, rankPost,
  rankWhy, removeGroupPost, removeMemberPost, revokePost, sampleRuns, settingsFormOf, settingsHtml, settingsPost, settingsTextOf, survivorName, tagRuns, whoOptions,
  type Built, type ChatForm, type Fault, type MemberRow, type SettingsForm,
} from "../core/admin/permissions.ts";
import { esc } from "../core/admin/format.ts";
import { base64 } from "../core/admin/screens.ts";
import type { TextRun } from "../../shared/net/chat.ts";
import type { PartKey } from "../../shared/permissions/chat.ts";
import type { MemberKind } from "../../shared/permissions/model.ts";
import { PERMISSIONS_API, PERMISSIONS_STATE, type ImportKind, type PermissionsAnswer, type PermissionsPost, type PermissionsState } from "../../shared/permissions/page.ts";
import { RANK_CLUSTER } from "../../shared/ranks.ts";

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const TABS = ["groups", "members", "chat", "import"] as const;

/** The page's state: the store as last read, the rows drawn from it, and drafts of the chat forms that outlive a read. */
const S = {
  state: null as PermissionsState | null,
  rows: [] as MemberRow[],
  /** Chat forms being edited, by group name in lower case; null where the draft is to have no block. */
  chat: new Map<string, ChatForm | null>(),
  settings: null as SettingsForm | null,
  settingsChanged: false,
  /** The text the last good check was of, which Apply sends. */
  checked: null as { kind: ImportKind; text: string } | null,
  loading: false,
};

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

const chatForm = (name: string): ChatForm | null => {
  const key = name.toLowerCase();
  if (S.chat.has(key)) return S.chat.get(key)!;
  return chatFormOf(S.state?.groups.find((g) => g.name.toLowerCase() === key)?.chat ?? "").form;
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
  const read = S.chat.has(name.toLowerCase()) ? [] : chatFormOf(S.state?.groups.find((g) => g.name.toLowerCase() === name.toLowerCase())?.chat ?? "").faults;
  return [...read.map((text) => ({ at: "", text: `As saved: ${text}` })), ...chatBlockOf(form).faults];
}

function drawChat(): void {
  const state = S.state!;
  // Typing changes the fields and not the HTML they were drawn from, so these are always drawn anew.
  paint($("chat-groups"), state.groups.map((g) => chatGroupHtml(state, g, chatForm(g.name), chatFaults(g.name))).join(""), true);
  paint($("chat-settings"), settingsHtml(state, S.settings!, settingsTextOf(S.settings!).faults), true);
  drawSamples();
}

function draw(): void {
  const state = S.state;
  if (!state) return;
  const manage = manageWhy(state);
  $("me").textContent = meText(state);
  $("unsaved").hidden = state.saved;
  paint($("groups"), groupsHtml(state));
  paint($("permission-list"), permissionListHtml(state));
  paint($("group-list"), state.groups.map((g) => `<option value="${esc(g.name)}">`).join(""));
  paint($("world-list"), state.worlds.map((w) => `<option value="${esc(w.name)}">`).join(""));
  const rank = $<HTMLSelectElement>("group-rank");
  paint(rank, rankOptions(Number(rank.value || 0), (r) => rankWhy(state, r)));
  for (const id of ["group-name", "add-group", "member-kind", "member-who", "member-group", "member-hours", "member-delay", "add-member", "import-kind", "import-file", "import-text", "import-check"]) {
    allow($<HTMLInputElement>(id), manage);
  }
  const group = $<HTMLSelectElement>("member-group");
  paint(group, memberGroupOptions(state, group.value));
  paint($("who-list"), whoOptions(state, $<HTMLSelectElement>("member-kind").value as MemberKind));
  $("member-every-label").hidden = state.me.rank < RANK_CLUSTER;
  S.rows = memberRows(state, Date.now());
  paint($("members"), memberRowsHtml(S.rows));
  paint($("passwords"), passwordRowsHtml(passwordRows(state)));
  if (!S.settingsChanged) {
    const read = settingsFormOf(state.document);
    S.settings = read.form;
    $("settings-read").textContent = read.faults.length ? `As saved: ${read.faults.join(" ")}` : "";
  }
  drawChat();
  allow($<HTMLButtonElement>("import-apply"), manage || (S.checked ? "" : "Check it first."));
}

// ---- Reading and sending ----

async function load(): Promise<void> {
  if (S.loading) return;
  S.loading = true;
  try {
    const r = await fetch(PERMISSIONS_STATE, { cache: "no-store" });
    if (!r.ok) throw new Error(r.status === 401 ? "Sign in on the overview first." : `The permissions answered ${r.status}: ${await r.text()}`);
    S.state = (await r.json()) as PermissionsState;
    if ($("msg").textContent === "Loading…") say("");
    $("reload").hidden = true;
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
  const r = await fetch(PERMISSIONS_API, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(post) });
  const answer = (await r.json().catch(() => ({}))) as Partial<PermissionsAnswer>;
  const ok = r.ok && answer.ok === true;
  if (ok) say(done, "well");
  else say(answer.why || `The server answered ${r.status}.`, "bad");
  await load();
  return { ...answer, ok, why: answer.why ?? "" };
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

function showPassword(id: string, password: string): void {
  const state = S.state!;
  $("password-for").textContent = `A new password for ${survivorName(state, id) || "the survivor"} (${id})`;
  const box = $<HTMLInputElement>("password-text");
  box.value = password;
  $("new-password").hidden = false;
  box.focus();
  box.select();
}

function hidePassword(): void {
  $<HTMLInputElement>("password-text").value = "";
  $("password-for").textContent = "";
  $("new-password").hidden = true;
}

/** The text an import sends: the file as base64, or what was pasted. */
async function importText(kind: ImportKind): Promise<string> {
  if (kind !== "arkapi") return $<HTMLTextAreaElement>("import-text").value;
  const file = $<HTMLInputElement>("import-file").files?.[0];
  return file ? base64(new Uint8Array(await file.arrayBuffer())) : "";
}

function forgetCheck(): void {
  S.checked = null;
  if (S.state) allow($<HTMLButtonElement>("import-apply"), manageWhy(S.state) || "Check it first.");
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
    case "issue": {
      const id = at.dataset.id!;
      if (state.passwords.includes(id) && !confirm(`Give ${survivorName(state, id) || id} a new password? Their old one stops working.`)) return;
      const b = passwordPost(state, id);
      if (!b.post) return say(b.why, "warn");
      hidePassword();
      const answer = await send(b.post, "Issued a password. Copy it from the box below.");
      if (answer.ok && answer.password) showPassword(id, answer.password);
      return;
    }
    case "clear-password": {
      const id = at.dataset.id!;
      if (!confirm(`Clear the password of ${survivorName(state, id) || id}? They lose their staff powers until they are given a new one.`)) return;
      await sendBuilt(clearPasswordPost(state, id), "Cleared the password.");
      return;
    }
    case "copy-password":
      await navigator.clipboard.writeText($<HTMLInputElement>("password-text").value).then(() => say("Copied the password.", "well"), () => say("The browser did not copy it. Select it and copy it by hand.", "warn"));
      return;
    case "done-password":
      return hidePassword();
    case "chat-add":
      S.chat.set(key, blankChatForm());
      return drawChat();
    case "chat-undo":
      S.chat.delete(key);
      return drawChat();
    case "chat-save": {
      const form = chatForm(group);
      if (!form) return;
      const block = chatBlockOf(form);
      if (block.faults.length > 0) return say("Not sent: the chat format has faults. Each is shown beside its field.", "warn");
      const done = await sendBuilt(chatPost(state, group, block.text), `Saved the chat format of ${group}.`);
      if (done?.ok) S.chat.delete(key), drawChat();
      return;
    }
    case "chat-remove": {
      if (!confirm(`Remove the chat format of ${group}?`)) return;
      const done = await sendBuilt(chatPost(state, group, ""), `${group} has no chat format now.`);
      if (done?.ok) S.chat.delete(key), drawChat();
      return;
    }
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
      S.settingsChanged = false;
      return draw();
    case "settings-save": {
      const made = settingsTextOf(S.settings!);
      if (made.faults.length > 0) return say("Not sent: the chat settings have faults. Each is shown beside its field.", "warn");
      const b = settingsPost(state, made.text);
      if (!b.post) return say(b.why, "warn");
      const draft = S.settings!;
      S.settingsChanged = false;
      const done = await send(b.post, "Saved the chat settings.");
      if (!done.ok) [S.settings, S.settingsChanged] = [draft, true], draw();
      return;
    }
    case "import-check":
    case "import-apply": {
      const apply = what === "import-apply";
      const kind = apply && S.checked ? S.checked.kind : ($<HTMLSelectElement>("import-kind").value as ImportKind);
      const text = apply && S.checked ? S.checked.text : await importText(kind);
      const b = importPost(state, kind, text, apply);
      if (!b.post) return say(b.why, "warn");
      if (apply && !confirm("Make these changes?")) return;
      const answer = await send(b.post, apply ? "Imported." : "Checked. Nothing is changed until Apply.");
      $("import-out").innerHTML = importHtml(answer, apply);
      if (apply || !answer.ok) forgetCheck();
      else {
        S.checked = { kind, text };
        allow($<HTMLButtonElement>("import-apply"), manageWhy(state));
      }
      return;
    }
    case "reload":
      return load();
  }
}

/** The chat form of a group to change: its draft, begun from what is saved. */
function draftOf(name: string): ChatForm | null {
  const key = name.toLowerCase();
  if (!S.chat.has(key)) {
    const form = chatForm(name);
    S.chat.set(key, form ? structuredClone(form) : null);
  }
  return S.chat.get(key) ?? null;
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
  if (at.dataset.tab) return showTab(at.dataset.tab);
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
    // A refused change leaves the page's HTML as it was, so the choice is put back by hand.
    const back = (): void => void (at.value = String(S.state?.groups.find((g) => g.name === group)?.rank ?? at.value));
    void sendBuilt(rankPost(state, group, Number(at.value)), `${group} is of the ${at.selectedOptions[0]?.textContent ?? ""} rank now.`).then(back, (e: unknown) => (back(), failed(e)));
  } else if (at.id === "member-kind") {
    paint($("who-list"), whoOptions(state, $<HTMLSelectElement>("member-kind").value as MemberKind));
    $<HTMLInputElement>("member-who").placeholder = $<HTMLSelectElement>("member-kind").value === "tribe" ? "Tribe name or number" : "Name or 17-digit ID";
  } else if (at.id === "import-kind") {
    const pasted = $<HTMLSelectElement>("import-kind").value !== "arkapi";
    $("import-file-bar").hidden = pasted;
    $("import-text").hidden = !pasted;
    forgetCheck();
  } else if (at.id === "import-file") forgetCheck();
});

addEventListener("beforeunload", (e) => {
  if (S.settingsChanged || S.chat.size > 0) e.preventDefault();
});

addEventListener("hashchange", () => showTab(location.hash.slice(1)));
showTab(location.hash.slice(1));
void load();
