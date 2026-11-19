// bun tools/ticks.ts <http://host:port[/path]/admin/ticks.json | ticks.json> [--all]: a server's long ticks (server/admin/parts.ts),
// each called the server's own work, the machine's for want of a core, or the machine's for want of a page, by the process's
// counters over it, with the time of each kind, the parts the server's own spent it in, and the newest twenty (--all: every
// one held). A server that is not --dev is asked with SNARK_ADMIN_PASSWORD. The process's CPU time is all its threads', so a
// tick called its own may hold some of the engine's helpers' time too: the call errs toward the server.

import type { LongTick, TickReport } from "../server/admin/parts.ts";

/** A long tick's time and counters: its own when the tick itself was long, else the time between it and the tick before. */
export function measure(r: TickReport, t: LongTick): { ms: number; cpu: number; pageIns: number; preempted: number; kind: "own" | "core" | "page" } {
  const between = r.parts.indexOf("sockets");
  const ownTick = t.ms > r.limit;
  const ms = ownTick ? t.ms : t.parts.slice(between).reduce((a, b) => a + b, 0);
  const [cpu, pageIns, , , preempted] = ownTick ? t.counts : t.gap;
  const kind = cpu! >= 0.7 * ms ? "own" : pageIns! > 0 ? "page" : "core";
  return { ms, cpu: cpu!, pageIns: pageIns!, preempted: preempted!, kind };
}

/** Lines saying what the long ticks were, kind by kind and part by part. */
export function describe(r: TickReport, all = false): string[] {
  const out = [`${r.ticks} ticks, ${r.long} kept as long (over ${r.limit.toFixed(1)} ms, or as long before them); ${r.recent.length} held`];
  const kinds = new Map<string, { n: number; ms: number }>();
  const own = new Float64Array(r.parts.length);
  for (const t of r.recent) {
    const m = measure(r, t);
    const k = kinds.get(m.kind) ?? { n: 0, ms: 0 };
    k.n++;
    k.ms += m.ms;
    kinds.set(m.kind, k);
    if (m.kind === "own") t.parts.forEach((v, i) => (own[i] += v));
  }
  const total = [...kinds.values()].reduce((a, k) => a + k.ms, 0);
  const names = { own: "the server's own", core: "waiting for a core", page: "waiting for pages" } as const;
  out.push("by kind: " + ([...kinds] as [keyof typeof names, { n: number; ms: number }][]).map(([k, v]) => `${names[k]} ${v.n} ticks, ${v.ms.toFixed(0)} ms (${((100 * v.ms) / Math.max(1, total)).toFixed(0)}%)`).join("; "));
  const ownTotal = own.reduce((a, b) => a + b, 0);
  if (ownTotal > 0) out.push("the server's own, by part: " + r.parts.map((p, i) => [p, own[i]!] as const).filter(([, v]) => v >= 0.005 * ownTotal).sort((a, b) => b[1] - a[1]).map(([p, v]) => `${p} ${((100 * v) / ownTotal).toFixed(0)}%`).join(", "));
  for (const t of all ? r.recent : r.recent.slice(-20)) {
    const m = measure(r, t);
    const parts = r.parts.map((p, i) => [p, t.parts[i]!] as const).filter(([, v]) => v >= 1).map(([p, v]) => `${p} ${v.toFixed(0)}`).join(" ");
    out.push(`  ${new Date(t.at).toISOString().slice(11, 23)} tick ${t.tick}: ${t.ms.toFixed(0)} ms, late ${t.late.toFixed(0)}; ${m.kind}, CPU ${m.cpu.toFixed(0)} ms, page-ins ${m.pageIns}, preempted ${m.preempted}; ${parts}`);
  }
  return out;
}

if (import.meta.main) {
  const [from] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  if (!from) throw new Error("bun tools/ticks.ts <url of /admin/ticks.json | file> [--all]");
  const password = process.env.SNARK_ADMIN_PASSWORD;
  const text = /^https?:\/\//.test(from)
    ? await (await fetch(from, password ? { headers: { authorization: `Basic ${btoa(`admin:${password}`)}` } } : {})).text()
    : await Bun.file(from).text();
  for (const line of describe(JSON.parse(text) as TickReport, process.argv.includes("--all"))) console.log(line);
}
