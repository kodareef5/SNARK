import { ADMIN_TERRAIN_SIDE as SIDE } from "../../shared/admin.ts";
import { ClusterAdmin, basicAuth, counts, preview, signedInText, type ClusterWorld } from "../core/admin/cluster.ts";
import { worldAdminAddress } from "./cluster-address.ts";
import { addChatChannels, chatPanel } from "./chat.ts";
import { adminContext } from "./shell.ts";

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const ctx = await adminContext().catch(() => null);
const view = (ctx?.view ?? location.pathname.split("/")[2]) === "chat" ? "chat" : "overview";
const isChat = view === "chat";
const title = isChat ? "Cluster chat" : "Cluster overview";
$("cluster-title").textContent = title;
document.title = `${title} · SNARK Admin`;
$("cluster-overview").hidden = isChat;
$("cluster-chat").hidden = !isChat;

const worldFilter = $<HTMLSelectElement>("chat-world"), channel = $<HTMLSelectElement>("chat-channel");
const password = $<HTMLInputElement>("password");
const signInName = $<HTMLInputElement>("sign-in-name");
const signInWorld = $<HTMLSelectElement>("sign-in-world");
const submitPassword = $<HTMLButtonElement>("submit-password");
const elements = new Map<string, HTMLElement>();
const updated = $<HTMLTimeElement>("updated");
const dashboard = new ClusterAdmin((path, auth) => fetch(path, {
  signal: AbortSignal.timeout(4500), mode: "same-origin", credentials: "omit", redirect: "error", cache: "no-store",
  ...(auth ? { headers: { authorization: auth } } : {}),
}), (world) => worldAdminAddress(world, location.origin), view, ctx?.worlds);

function drawPreview(el: HTMLElement, card: ClusterWorld): void {
  const map = preview(card);
  const canvas = el.querySelector("canvas")!;
  const empty = el.querySelector<HTMLElement>(".cluster-map-empty")!;
  canvas.hidden = !map;
  el.querySelector<HTMLElement>(".cluster-map-north")!.hidden = !map?.ground;
  el.querySelector<HTMLElement>(".cluster-map-key")!.hidden = !map?.points.length;
  empty.hidden = !!map;
  empty.textContent = card.status === "Connecting" ? "Loading map…" : "Map preview unavailable";
  if (!map) return;
  const ground = map.ground ? `${card.world.map} terrain` : `${card.world.map} positions`;
  canvas.setAttribute("aria-label", card.overview ? `${ground}, ${map.points.length} online survivors shown` : ground);
  const g = canvas.getContext("2d");
  if (!g) return;
  if (map.ground) {
    g.putImageData(new ImageData(map.ground, SIDE, SIDE), 0, 0);
    g.beginPath();
    for (let i = 1; i < 4; i++) {
      const at = SIDE * i / 4 + .5;
      g.moveTo(at, 0);
      g.lineTo(at, SIDE);
      g.moveTo(0, at);
      g.lineTo(SIDE, at);
    }
    g.lineWidth = .5;
    g.strokeStyle = "#22466d44";
    g.stroke();
  } else g.clearRect(0, 0, SIDE, SIDE);
  for (const { x, y, size, colour } of map.bases) {
    g.fillStyle = colour;
    g.fillRect(x, y, size, size);
  }
  g.lineWidth = 1;
  g.strokeStyle = "#122c4b";
  for (const { x, y } of map.points) {
    g.beginPath();
    g.arc(x, y, 4, 0, Math.PI * 2);
    g.fillStyle = "#fff";
    g.fill();
    g.stroke();
    g.beginPath();
    g.arc(x, y, 2.35, 0, Math.PI * 2);
    g.fillStyle = "#bd4327";
    g.fill();
  }
}

function renderCard(el: HTMLElement, card: ClusterWorld): void {
  const { world, admin, health } = card;
  const { players, max } = counts(card);
  const link = el.querySelector("a")!;
  link.textContent = world.name;
  link.href = admin.link;
  const mapName = el.querySelector<HTMLElement>(".cluster-map-name")!;
  mapName.textContent = world.map === world.name ? "" : world.map;
  mapName.hidden = !mapName.textContent;
  const badge = el.querySelector<HTMLElement>(".cluster-health")!;
  badge.textContent = health?.word ?? card.status;
  badge.dataset.state = health ? String(health.level) : card.locked ? "locked" : admin.api ? "waiting" : "remote";
  const note = el.querySelector<HTMLElement>(".cluster-world-note")!;
  note.textContent = health?.reasons[0] ?? card.cover;
  note.hidden = !note.textContent || card.status === "Connecting";
  el.querySelector(".cluster-count")!.textContent = `${players} / ${max} online`;
  const bar = el.querySelector("progress")!;
  bar.max = Math.max(max, 1);
  bar.value = players;
  el.querySelector(".cluster-world-open span")!.textContent = admin.api ? "Open map" : "Open world admin";
  drawPreview(el, card);
}

const chat = chatPanel($("chat-lines"), $("chat-state"));
const renderChat = (): void => chat(dashboard.chat(worldFilter.value, channel.value));

function setOptions(select: HTMLSelectElement, options: HTMLOptionElement[], fallback = ""): void {
  if (options.length === select.length && options.every((o, i) => o.value === select.options[i]?.value && o.text === select.options[i]?.text)) return;
  const selected = select.value;
  select.replaceChildren(...options);
  select.value = options.some((option) => option.value === selected) ? selected : fallback;
}

function renderAccess(): void {
  const locked = [...dashboard.worlds.values()].filter((card) => card.locked);
  const sole = locked.length === 1 ? locked[0] : undefined;
  const busy = dashboard.authenticating;
  $("access").hidden = !locked.length && !dashboard.signedIn;
  $("sign-out").hidden = !dashboard.signedIn;
  $("sign-in-world-field").hidden = locked.length < 2;
  submitPassword.hidden = $("password-field").hidden = $("name-field").hidden = !locked.length;
  const options = locked.map(({ world, admin }) => new Option(world.name, admin.link));
  if (locked.length > 1) options.unshift(new Option("Choose a world", ""));
  setOptions(signInWorld, options, sole?.admin.link);
  signInWorld.required = locked.length > 1;
  signInWorld.disabled = busy || locked.length < 2;
  submitPassword.disabled = password.disabled = signInName.disabled = busy || !locked.length;
  submitPassword.textContent = busy ? "Signing in…" : "Sign in";
  $("password-label").textContent = sole ? `Password for ${sole.world.name}` : "Password";
  const who = signedInText(dashboard.signedInAs);
  if ($("signed-in-as").textContent !== who) $("signed-in-as").textContent = who;
  $("signed-in-as").hidden = who === "";
  const selected = dashboard.worlds.get(signInWorld.value);
  const notice = !busy && selected?.locked ? selected.cover : "";
  const noun = locked.length === 1 ? "world needs its" : "worlds need their";
  const note = notice || (locked.length ? `${locked.length} ${noun} admin password.` : "Signed in for this page.");
  if ($("access-note").textContent !== note) $("access-note").textContent = note;
}

function renderOverview(players: number, max: number): void {
  $("world-count").textContent = String(dashboard.worlds.size);
  $("player-count").textContent = String(players);
  $("capacity-count").textContent = String(max);
  const empty = $("world-state");
  const state = dashboard.discovered ? (dashboard.worlds.size ? "" : "No worlds are running.") :
    dashboard.worlds.size ? "The world list is temporarily unavailable." : "Discovering worlds…";
  if (empty.textContent !== state) empty.textContent = state;
  empty.hidden = !state;
  for (const [key, el] of elements) if (!dashboard.worlds.has(key)) {
    el.remove();
    elements.delete(key);
  }
  for (const [key, card] of dashboard.worlds) {
    let el = elements.get(key);
    if (!el) {
      el = $<HTMLTemplateElement>("world-card").content.firstElementChild!.cloneNode(true) as HTMLElement;
      $("worlds").append(el);
      elements.set(key, el);
    }
    renderCard(el, card);
  }
}

function render(): void {
  const { players, max } = dashboard.totals();
  renderAccess();
  if (!isChat) {
    renderOverview(players, max);
    return;
  }
  const options = [new Option("All worlds", ""), ...[...dashboard.worlds].map(([key, { world }]) => new Option(world.name, key))];
  setOptions(worldFilter, options);
  renderChat();
}

async function refresh(): Promise<void> {
  if (document.hidden || !await dashboard.refresh()) return;
  const now = new Date();
  updated.dateTime = dashboard.discovered ? now.toISOString() : "";
  updated.textContent = dashboard.discovered ? `Checked ${now.toLocaleTimeString()}` : "World list unavailable";
  updated.hidden = false;
  render();
}

$("sign-in").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!signInWorld.value || dashboard.authenticating) return;
  const pending = dashboard.signIn(signInWorld.value, basicAuth(signInName.value, password.value));
  password.value = "";
  render();
  await pending;
  render();
});
signInWorld.addEventListener("change", () => {
  password.value = "";
  renderAccess();
});
$("sign-out").addEventListener("click", () => {
  dashboard.signOut();
  password.value = "";
  render();
  void refresh();
});
if (isChat) {
  addChatChannels(channel);
  worldFilter.addEventListener("change", renderChat);
  channel.addEventListener("change", renderChat);
}
render();
document.addEventListener("visibilitychange", () => void refresh());
void refresh();
setInterval(() => void refresh(), 5000);
