import type { LogMark } from "../../../shared/survivor-log.ts";

export const MAP_LAYERS = ["streets", "places", "bases", "trails", "events", "offline", "names"] as const;
export type MapLayer = (typeof MAP_LAYERS)[number];
export const DEFAULT_LAYERS = MAP_LAYERS.filter((layer) => layer !== "offline");

export interface InvestigatedItem {
  item: string;
  quality: number;
  blueprint: boolean;
}

export interface Investigation {
  at: number | null;
  start: number | null;
  end: number | null;
  survivor: number;
  item: InvestigatedItem | null;
  layers: readonly MapLayer[];
  camera: { x: number; z: number; zoom: number } | null;
}

interface QueryReader { get(key: string): string | null }
interface QueryWriter { set(key: string, value: string): void; delete(key: string): void }

function numberAt(params: QueryReader, key: string): number | null {
  const text = params.get(key);
  if (!text?.trim()) return null;
  const value = Number(text);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function wholeAt(params: QueryReader, key: string): number | null {
  const value = numberAt(params, key);
  return value !== null && Number.isSafeInteger(value) ? value : null;
}

export const itemKey = (item: InvestigatedItem): string => `${item.item}|${item.quality}|${Number(item.blueprint)}`;

export function readItem(key: string): InvestigatedItem | null {
  const m = /^([a-z0-9_:/.-]{1,160})\|([0-9]{1,3})\|([01])$/i.exec(key);
  return m ? { item: m[1]!, quality: Number(m[2]), blueprint: m[3] === "1" } : null;
}

/** Takes only usable navigation fields and leaves unrelated query parameters to the shell. */
export function readInvestigation(params: QueryReader): Investigation {
  const start = wholeAt(params, "from"), end = wholeAt(params, "to"), at = wholeAt(params, "at");
  const span = start !== null && end !== null && start < end;
  const x = numberAt(params, "x"), z = numberAt(params, "z"), zoom = numberAt(params, "zoom");
  const layers = params.get("layers")?.split(",") ?? null;
  return {
    at,
    start: span ? start : null,
    end: span ? end : null,
    survivor: wholeAt(params, "survivor") ?? 0,
    item: readItem(params.get("item") ?? ""),
    layers: layers === null ? DEFAULT_LAYERS : MAP_LAYERS.filter((layer) => layers.includes(layer)),
    camera: x !== null && z !== null && zoom !== null && zoom > 0 ? { x, z, zoom } : null,
  };
}

export function writeInvestigation(params: QueryWriter, state: Investigation): void {
  const put = (key: string, value: string | number | null): void => {
    if (value === null) params.delete(key);
    else params.set(key, String(value));
  };
  put("at", state.at === null ? null : Math.floor(state.at));
  put("from", state.start === null ? null : Math.floor(state.start));
  put("to", state.end === null ? null : Math.ceil(state.end));
  put("survivor", state.survivor || null);
  put("item", state.item ? itemKey(state.item) : null);
  const layers = MAP_LAYERS.filter((layer) => state.layers.includes(layer)).join(",");
  put("layers", layers === DEFAULT_LAYERS.join(",") ? null : layers);
  put("x", state.camera ? Math.round(state.camera.x) : null);
  put("z", state.camera ? Math.round(state.camera.z) : null);
  put("zoom", state.camera ? Number(state.camera.zoom.toPrecision(5)) : null);
}

export type EventFilter = "all" | LogMark["kind"];

export function windowEvents(marks: readonly LogMark[], start: number, end: number, filter: EventFilter): LogMark[] {
  return marks.filter((mark) => mark.wall >= start && mark.wall <= end && (filter === "all" || mark.kind === filter));
}

export function nextEvent(marks: readonly LogMark[], at: number, direction: -1 | 1): LogMark | null {
  let nearest: LogMark | null = null;
  for (const mark of marks) {
    const difference = (mark.wall - at) * direction;
    if (difference > 0 && (!nearest || difference < (nearest.wall - at) * direction)) nearest = mark;
  }
  return nearest;
}
