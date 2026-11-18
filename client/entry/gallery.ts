import { esc } from "./forms.ts";
import type { EntrySurvivor } from "../core/entry-state.ts";

export interface WorldCard {
  name: string;
  map: string;
  mapId: string;
  address: string;
  players: number;
  max: number;
  password?: boolean;
  online?: boolean;
}
export interface MapArt {
  label: string;
  mapTile: string;
  cover: string;
  overview?: string;
  regions: Record<string, string>;
}
type Catalog = Record<string, MapArt>;
let catalogue: Catalog = {};
export async function loadGallery() {
  const res = await fetch("title/maps.json");
  if (res.ok) catalogue = await res.json();
}
export function mapArt(id: string | undefined, label: string | undefined) {
  const key = id || "core:" + (label ?? "").toLowerCase().replace(/\s+/g, "-");
  return catalogue[key];
}
export function imageTile(src: string | undefined, extra = "") {
  return (
    '<span aria-hidden="true" class="tile-image ' + extra + '">' + (src ? '<img src="' + esc(src) + '" loading="lazy" alt="">' : "") + "</span>"
  );
}
export function serverCard(w: WorldCard) {
  const art = mapArt(w.mapId, w.map),
    live = w.online !== false;
  return (
    '<button type="button" class="server-card" data-action="world" data-world="' +
    esc(w.address) +
    '">' +
    imageTile(art?.cover) +
    '<span class="server-copy"><span class="map-label">' +
    esc(w.map) +
    "</span><strong>" +
    esc(w.name) +
    '</strong><span class="occupancy">' +
    (live ? "<i></i>" + esc(w.players) + " / " + esc(w.max) + " players" : "Offline") +
    '</span></span><span class="card-foot">' +
    (w.password === true ? "Password required" : w.password === false ? "Open access" : "Server details") +
    '<span aria-hidden="true">↗</span></span></button>'
  );
}
export function mapChoices(worlds: WorldCard[], selected: string) {
  const hosts = [...new Map(worlds.map((w) => [w.address, w])).values()];
  const names = [...new Set([...Object.values(catalogue).map((a) => a.label), ...hosts.map((w) => w.map)])];
  const count = (map: string) => hosts.filter((w) => w.map === map).length;
  names.sort((a, b) => count(b) - count(a) || a.localeCompare(b));
  return names
    .map((name) => {
      const art = mapArt(hosts.find((w) => w.map === name)?.mapId, name),
        n = count(name);
      return (
        '<button type="button" class="map-option" data-action="choose-map" data-map="' +
        esc(name) +
        '" aria-pressed="' +
        (name === selected) +
        '">' +
        imageTile(art?.mapTile) +
        "<span><strong>" +
        esc(name) +
        "</strong><small>" +
        (n ? n + " " + (n === 1 ? "server" : "servers") : "No listings") +
        "</small></span></button>"
      );
    })
    .join("");
}
const dates = new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
function playTime(ms: number | null | undefined) {
  if (ms == null || !Number.isFinite(ms)) return "Unrecorded";
  const s = Math.floor(Math.max(0, ms) / 1000),
    m = Math.floor(s / 60);
  return m >= 60 ? Math.floor(m / 60) + "h " + (m % 60) + "m" : m ? m + "m" : s + "s";
}
export function survivorStats(r: EntrySurvivor) {
  const login =
    r.lastLogin && Number.isFinite(r.lastLogin)
      ? '<time datetime="' + new Date(r.lastLogin).toISOString() + '">' + esc(dates.format(r.lastLogin)) + "</time>"
      : "Unrecorded";
  return (
    '<dl class="survivor-stats"><div><dt>Level</dt><dd>' +
    esc(r.level) +
    "</dd></div><div><dt>XP</dt><dd>" +
    (r.xp == null ? "Unrecorded" : esc(Math.floor(r.xp).toLocaleString())) +
    "</dd></div><div><dt>Play time</dt><dd>" +
    playTime(r.playMs) +
    '</dd></div><div class="login"><dt>Last login</dt><dd>' +
    login +
    "</dd></div></dl>"
  );
}
export function regionTiles(
  points: { name: string; x: number; z: number }[],
  art: MapArt | undefined,
  selected: number,
  width: number,
  height: number,
) {
  return (
    '<div class="region-cards">' +
    points
      .map((p, i) => {
        const src = art?.regions[p.name],
          x = 100 * (1 - p.x / width),
          y = 100 * (1 - p.z / height);
        const thumb = src
          ? imageTile(src)
          : art?.overview
            ? '<span class="tile-image map-crop" aria-hidden="true" style="background-image:url(' +
              esc(art.overview) +
              ");background-position:" +
              x +
              "% " +
              y +
              '%"></span>'
            : imageTile(undefined);
        return (
          '<button class="region-card" type="button" data-action="place" data-index="' +
          i +
          '" aria-pressed="' +
          (i === selected) +
          '">' +
          thumb +
          '<span class="region-caption"><strong>' +
          esc(p.name) +
          '</strong><i aria-hidden="true">' +
          (i === selected ? "✓" : "") +
          "</i></span></button>"
        );
      })
      .join("") +
    "</div>"
  );
}
