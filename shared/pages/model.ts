// One public model's files. Each clip and texture is fetched independently of the game asset library.
import type { TextureRole } from "../pack/texture.ts";

export interface ModelBounds { center: [number, number, number]; radius: number; height: number; half?: [number, number, number] }
export interface ModelClip {
  id: string; label: string; url: string; bytes: number; seconds: number; frames: number; loop: boolean; bounds: ModelBounds;
}
export interface ModelTexture { slot: number; url: string; role: TextureRole; width: number; height: number; bytes: number }
export interface ModelDocument {
  version: 1; id: string; label: string; pack: string; packBytes: number; colors: number[]; bounds: ModelBounds;
  textures: ModelTexture[]; clips: ModelClip[];
}

const local = (v: unknown): v is string => typeof v === "string" && v.startsWith("/media/models/") && !/[\\\s%?#]/.test(v) && !v.split("/").some((s) => s === ".." || s === ".");
const positive = (v: unknown, most: number): v is number => typeof v === "number" && Number.isFinite(v) && v > 0 && v <= most;
function bounds(v: unknown): v is ModelBounds {
  if (!v || typeof v !== "object") return false;
  const b = v as ModelBounds;
  return Array.isArray(b.center) && b.center.length === 3 && b.center.every((n) => Number.isFinite(n) && Math.abs(n) < 10000) && positive(b.radius, 10000) && positive(b.height, 10000) && (b.half === undefined || Array.isArray(b.half) && b.half.length === 3 && b.half.every((n) => Number.isFinite(n) && n >= 0 && n < 10000));
}
/** Reject an oversized or unrelated asset graph before fetching it. The file host remains the only origin. */
export function modelDocument(value: unknown): ModelDocument {
  if (!value || typeof value !== "object") throw new Error("Invalid model document");
  const m = value as ModelDocument;
  if (m.version !== 1 || typeof m.id !== "string" || typeof m.label !== "string" || m.label.length > 200 || !local(m.pack) || !positive(m.packBytes, 8 * 1024 * 1024) || !bounds(m.bounds)) throw new Error("Unsupported model document");
  if (!Array.isArray(m.colors) || m.colors.length !== 6 || !m.colors.every((n) => Number.isInteger(n) && n >= 0 && n < 240)) throw new Error("Invalid model colours");
  if (!Array.isArray(m.textures) || m.textures.length > 24 || !Array.isArray(m.clips) || m.clips.length > 128) throw new Error("Model exceeds preview limits");
  let pixels = 0;
  const slots = new Set<number>();
  for (const t of m.textures) {
    if (!Number.isInteger(t.slot) || slots.has(t.slot) || t.slot < 0 || t.slot > 23 || !local(t.url) || !["base", "normal", "mro", "mask", "mask2", "layer"].includes(t.role) || !positive(t.width, 2048) || !positive(t.height, 2048) || !Number.isInteger(t.width) || !Number.isInteger(t.height) || !positive(t.bytes, 8 * 1024 * 1024)) throw new Error("Invalid model texture");
    slots.add(t.slot);
    pixels += t.width * t.height;
  }
  if (pixels * 4 * 4 / 3 > 80 * 1024 * 1024) throw new Error("Model textures exceed preview memory budget");
  const ids = new Set<string>();
  for (const c of m.clips) {
    if (typeof c.id !== "string" || typeof c.label !== "string" || c.label.length > 100 || ids.has(c.id) || !local(c.url) || !positive(c.bytes, 4 * 1024 * 1024) || !positive(c.seconds, 120) || !Number.isInteger(c.frames) || c.frames < 1 || c.frames > 3600 || typeof c.loop !== "boolean" || !bounds(c.bounds)) throw new Error("Invalid model animation");
    ids.add(c.id);
  }
  return m;
}
