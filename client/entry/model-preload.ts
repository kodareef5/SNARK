import { storedBytes, type Manifest } from "../../shared/pack/manifest.ts";
import { wholePart, type AssetArrival } from "../core/assets/port.ts";
import { tierOf, DEFAULT_TIER } from "../core/assets/tiers.ts";
import type { Ask } from "../assets/assets-worker.ts";

let worker: Worker | undefined,
  world = "",
  slot = 0;
const waiting = new Map<number, (ok: boolean) => void>();
function stop() {
  worker?.terminate();
  worker = undefined;
  for (const done of [...waiting.values()]) done(false);
}
function open(base: string) {
  if (worker && world === base) return worker;
  stop();
  world = base;
  worker = new Worker(new URL("assets-worker.js", base), { type: "module" });
  worker.onmessage = (event: MessageEvent<AssetArrival>) => {
    const reply = event.data;
    if (reply.slot !== undefined) waiting.get(reply.slot)?.(!reply.fail);
  };
  worker.onerror = stop;
  worker.postMessage({ open: { keep: tierOf(DEFAULT_TIER).diskBytes, touch: matchMedia("(pointer: coarse)").matches } });
  return worker;
}
function ask(port: Worker, req: Ask, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const cancel = () => {
      port.postMessage({ cancel: req.slot });
      done(false);
    };
    const done = (ok: boolean) => {
      waiting.delete(req.slot);
      signal.removeEventListener("abort", cancel);
      ok ? resolve() : reject(Error("The survivor model could not be prepared."));
    };
    waiting.set(req.slot, done);
    if (signal.aborted) {
      cancel();
      return;
    }
    signal.addEventListener("abort", cancel, { once: true });
    port.postMessage({ ask: req });
  });
}
/** The renderer's own worker verifies, inflates and caches the base mesh pages and the human animation rig. */
export async function warmSurvivor(base: string, m: Manifest, signal: AbortSignal) {
  const pages = new Set<number>();
  for (const mesh of m.meshes) {
    if (mesh.page !== undefined && /^core:human_[mf]\/(?!armor\/)/.test(mesh.id)) pages.add(mesh.page);
  }
  const parts = [...pages].map((i) => m.pages![i]!).concat((m.clips ?? []).filter((clip) => clip.rig === "human"));
  await warmParts(base, m, parts, signal);
}

/** These common early encounters share pages in the full pack. Each page holds the coarsest geometry. */
export async function warmWildlife(base: string, m: Manifest, signal: AbortSignal) {
  const ids = ["core:dodo", "core:parasaur", "core:raptor", "core:pteranodon"];
  const pages = new Set(ids.map(id => m.meshes.find(mesh => mesh.id === id)?.page));
  let budget = 128 * 1024;
  const parts = [];
  for (const i of pages) {
    const page = i === undefined ? undefined : m.pages?.[i];
    if (!page || storedBytes(page.part) > budget) continue;
    budget -= storedBytes(page.part);
    parts.push(page);
  }
  await warmParts(base, m, parts, signal);
}

async function warmParts(base: string, m: Manifest, parts: NonNullable<Manifest["pages"]>, signal: AbortSignal) {
  if (!parts.length || signal.aborted) return;
  const port = open(base);
  let index = 0;
  async function lane() {
    while (index < parts.length) {
      const p = parts[index++]!;
      await ask(port, { slot: ++slot, url: new URL("assets/" + m.files[p.file]!.name, base).href, parts: [wholePart(p)], fresh: false }, signal);
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, parts.length) }, lane));
}
