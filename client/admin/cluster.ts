import { ADMIN_TERRAIN_SIDE as SIDE } from "../../shared/admin.ts";
import { ClusterAdmin, counts, preview, type ClusterWorld } from "../core/admin/cluster.ts";
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

function renderAccess(locked: number): void {
  $("access").hidden = !locked && !dashboard.signedIn;
  $("sign-out").hidden = !dashboard.signedIn;
  $("submit-password").hidden = $("password-field").hidden = !locked;
  const noun = locked === 1 ? "world needs its" : "worlds need their";
  const note = locked ? `${locked} ${noun} admin password.` : "Signed in for this page.";
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
  const { players, max, locked } = dashboard.totals();
  renderAccess(locked);
  if (!isChat) {
    renderOverview(players, max);
    return;
  }
  const options = [new Option("All worlds", ""), ...[...dashboard.worlds].map(([key, { world }]) => new Option(world.name, key))];
  if (options.length !== worldFilter.length || options.some((o, i) => o.value !== worldFilter.options[i]?.value || o.text !== worldFilter.options[i]?.text)) {
    const selected = worldFilter.value;
    worldFilter.replaceChildren(...options);
    worldFilter.value = dashboard.worlds.has(selected) ? selected : "";
  }
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

function signIn(auth: string): void {
  dashboard.signIn(auth);
  password.value = "";
  render();
  void refresh();
}

$("sign-in").addEventListener("submit", (e) => {
  e.preventDefault();
  const bytes = new TextEncoder().encode(`admin:${password.value}`);
  signIn(`Basic ${btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(""))}`);
});
$("sign-out").addEventListener("click", () => signIn(""));
if (isChat) {
  addChatChannels(channel);
  worldFilter.addEventListener("change", renderChat);
  channel.addEventListener("change", renderChat);
}
render();
document.addEventListener("visibilitychange", () => void refresh());
void refresh();
setInterval(() => void refresh(), 5000);
