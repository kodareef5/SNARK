import { ADMIN_TERRAIN_SIDE as SIDE } from "../../shared/admin.ts";
import { ClusterAdmin, counts, preview, type ClusterWorld } from "../core/admin/cluster.ts";
import { addChatChannels, chatPanel } from "./chat.ts";

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const worldFilter = $<HTMLSelectElement>("chat-world"), channel = $<HTMLSelectElement>("chat-channel");
const password = $<HTMLInputElement>("password");
const elements = new Map<string, HTMLElement>();
const dashboard = new ClusterAdmin((path, auth) => fetch(path, {
  signal: AbortSignal.timeout(4500), mode: "same-origin", credentials: "omit", redirect: "error", cache: "no-store",
  ...(auth ? { headers: { authorization: auth } } : {}),
}), (address) => {
  const url = new URL("admin/", new URL(address, location.origin));
  return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? { link: url.href, local: url.origin === location.origin } : null;
});

function renderCard(el: HTMLElement, card: ClusterWorld): void {
  const { world, admin, health } = card;
  const count = counts(card);
  const map = preview(card);
  el.querySelector("h3")!.textContent = world.name;
  el.querySelector("a")!.href = admin.link;
  el.querySelector(".count")!.textContent = `${world.map} · ${count.players} / ${count.max} online`;
  el.querySelector(".detail")!.textContent = health?.reasons[0] ?? "";
  const badge = el.querySelector<HTMLElement>(".health")!, cover = el.querySelector<HTMLElement>(".cover")!;
  badge.textContent = health?.word ?? card.status;
  badge.dataset.level = health ? String(health.level) : "";
  cover.textContent = map ? "Terrain unavailable. Showing live positions and bases." : card.cover;
  cover.hidden = !!map?.ground;
  const canvas = el.querySelector("canvas")!;
  canvas.hidden = !map;
  if (!map) return;
  canvas.setAttribute("aria-label", map.points.length ? `Online positions: ${map.points.map((p) => p.name).join(", ")}` : "No online survivors with a position");
  const g = canvas.getContext("2d")!;
  if (map.ground) g.putImageData(new ImageData(map.ground, SIDE, SIDE), 0, 0);
  else g.clearRect(0, 0, SIDE, SIDE);
  for (const { x, y, size, colour } of map.bases) {
    g.fillStyle = colour;
    g.fillRect(x, y, size, size);
  }
  g.strokeStyle = "#0a111a";
  g.fillStyle = "#adf6db";
  for (const { x, y } of map.points) {
    g.beginPath();
    g.arc(x, y, 2.5, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  }
}

const chat = chatPanel($("chat-lines"), $("chat-state"));
const renderChat = (): void => chat(dashboard.chat(worldFilter.value, channel.value));
function render(): void {
  const { players, max, locked } = dashboard.totals();
  $("world-count").textContent = String(dashboard.worlds.size);
  $("player-count").textContent = `${players} / ${max}`;
  $("access").hidden = !locked && !dashboard.signedIn;
  $("sign-out").hidden = !dashboard.signedIn;
  $("access-note").textContent = locked ? `${locked} ${locked === 1 ? "world requires its" : "worlds require their"} admin password. Use the cluster’s shared password to open their data here.` : "This page is using the password you entered.";
  for (const [key, el] of elements) if (!dashboard.worlds.has(key)) { el.remove(); elements.delete(key); }
  for (const [key, card] of dashboard.worlds) {
    if (!elements.has(key)) {
      const el = $("world-card") as HTMLTemplateElement;
      const node = el.content.firstElementChild!.cloneNode(true) as HTMLElement;
      $("worlds").append(node);
      elements.set(key, node);
    }
    renderCard(elements.get(key)!, card);
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
  $("updated").textContent = !dashboard.discovered ? "World list unavailable. Retrying…" :
    dashboard.worlds.size ? `Updated ${new Date().toLocaleTimeString()}` : "No worlds are running.";
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
addChatChannels(channel);
worldFilter.addEventListener("change", renderChat);
channel.addEventListener("change", renderChat);
document.addEventListener("visibilitychange", () => void refresh());
void refresh();
setInterval(() => void refresh(), 5000);
