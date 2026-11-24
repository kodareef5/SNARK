import { readHead, type MapHead, type MapPart } from "../../shared/world/mapfile.ts";
import { firstFrameParts, partDistance } from "../core/map-first.ts";
import { constrainedConnection, startupBudget } from "../core/startup-budget.ts";
import { connectionHint, startupQueue } from "./startup-budget.ts";

const KIB = 1024;
const MIB = 1024 * KIB;
const CORE_ASSET = /^assets\/[\w.-]+\.[0-9a-f]{16}\.(?:snpk|json|bin)$/;
const MAP_HEAD = /^map\/head\.[0-9a-f]{16}\.part$/;

interface EntryMedia {
  boot?: string;
  content?: string;
  sky?: string;
  bytes?: Record<string, number>;
}

type Say = (message: string) => void;

class WorldWarmup {
  readonly queue: ReturnType<typeof startupQueue>;
  readonly base: string;

  constructor(base: string, budget: number) {
    this.base = base;
    this.queue = startupQueue(budget);
  }

  private async json<T>(path: string, signal: AbortSignal): Promise<T | null> {
    const got = await this.queue.ask({ url: this.base + path, rank: 90, wireLimit: 16 * KIB, decodedLimit: 16 * KIB, keep: true }, signal);
    if (!got?.data) return null;
    try {
      return JSON.parse(new TextDecoder().decode(got.data)) as T;
    } catch {
      return null;
    }
  }

  private async head(signal: AbortSignal): Promise<MapHead | null> {
    const named = await this.json<{ head?: string }>("map.json", signal);
    if (!named?.head || !MAP_HEAD.test(named.head)) return null;
    const got = await this.queue.ask({ url: this.base + named.head, rank: 80, wireLimit: MIB, decodedLimit: 4 * MIB, keep: true }, signal);
    if (!got?.data) return null;
    try {
      return readHead(got.data);
    } catch {
      return null;
    }
  }

  private async media(signal: AbortSignal): Promise<void> {
    const media = await this.json<EntryMedia>("entry-media.json", signal);
    if (!media) return;
    await Promise.all([media.boot, media.content, media.sky].map((path, i) => {
      if (!path || !CORE_ASSET.test(path)) return null;
      const decoded = media.bytes?.[path];
      if (decoded !== undefined && (!Number.isSafeInteger(decoded) || decoded <= 0 || decoded > 8 * MIB)) return null;
      return this.queue.ask({ url: this.base + path, rank: i === 0 ? 70 : 50, wireLimit: i === 0 ? 768 * KIB : 384 * KIB, decodedLimit: decoded ?? 8 * MIB }, signal);
    }));
  }

  private part(p: MapPart, signal: AbortSignal) {
    if (p.length <= 0 || p.length > 32 * MIB) return Promise.resolve(null);
    const wireLimit = Math.min(p.length, p.kind === "land" ? 2 * MIB : 512 * KIB);
    const rank = p.kind === "land" ? 65 : p.kind === "overview" ? 40 : 30;
    return this.queue.ask({ url: this.base + "map/" + p.name, rank, wireLimit, decodedLimit: p.length }, signal);
  }

  async launch(signal: AbortSignal): Promise<void> {
    await Promise.all([this.media(signal), this.head(signal).then((head) => {
      const definitions = head?.parts.find((p) => p.kind === "land");
      return definitions ? this.part(definitions, signal) : null;
    })]);
  }

  async spawn(x: number, z: number, signal: AbortSignal, say?: Say): Promise<void> {
    const head = await this.head(signal);
    if (!head || !Number.isFinite(x) || !Number.isFinite(z) || signal.aborted) return;
    const needed = firstFrameParts(head, x, z);
    const definitions = needed.find((p) => p.kind === "land");
    if (definitions) void this.part(definitions, signal);
    const parts = needed.filter((p) => p.kind === "overview" || p.kind === "ground");
    parts.sort((a, b) => partDistance(head, a, x, z) - partDistance(head, b, x, z));
    const first = parts.slice(0, 24);
    const warmed = await Promise.all(first.map((p) => this.part(p, signal)));
    if (!signal.aborted && first.length > 0 && first.length === parts.length && warmed.every(Boolean)) say?.("Spawn terrain ready");
  }
}

let current: WorldWarmup | undefined;

function forWorld(address: string): WorldWarmup | undefined {
  const base = new URL(address, document.baseURI);
  if (base.origin !== location.origin || !["http:", "https:"].includes(base.protocol) || base.username || base.password || !base.pathname.endsWith("/") || base.search || base.hash) return;
  const budget = startupBudget(connectionHint());
  if (budget === 0 || document.hidden) {
    stopPreloading();
    return;
  }
  if (current?.base !== base.href) {
    stopPreloading();
    current = new WorldWarmup(base.href, budget);
  }
  return current;
}

export function stopPreloading(): void {
  current?.queue.close();
  current = undefined;
}

addEventListener("pagehide", stopPreloading);
document.addEventListener("visibilitychange", () => { if (document.hidden) stopPreloading(); });
const connection = connectionHint();
connection?.addEventListener?.("change", () => { if (constrainedConnection(connection)) stopPreloading(); });

/** Start shared game files as soon as a world is selected. A slow connection spends no speculative bytes. */
export async function preloadLaunch(base: string, signal: AbortSignal): Promise<void> {
  if (!signal.aborted) await forWorld(base)?.launch(signal);
}

/** Warm the first-frame terrain around a known spawn or persisted survivor position. */
export async function preloadWorld(base: string, x: number, z: number, signal: AbortSignal, say?: Say): Promise<void> {
  if (signal.aborted) return;
  const world = forWorld(base);
  if (world) await Promise.all([world.launch(signal), world.spawn(x, z, signal, say)]);
}
