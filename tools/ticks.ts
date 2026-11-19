// bun tools/ticks.ts <http://host:port[/path]/admin/ticks.json | ticks.json> [--all]: a server's long ticks (server/admin/parts.ts),
// each called the server's own work, the machine's for want of a core, or the machine's for want of a page, by the process's
// counters over it (parts.ts measure), with the time of each kind, the parts the server's own spent it in, and the newest
// twenty (--all: every one held). A server that is not --dev is asked with SNARK_ADMIN_PASSWORD.

import { measure, partsText, type TickReport } from "../server/admin/parts.ts";

/** Lines saying what the long ticks were, kind by kind and part by part. */
export function describe(r: TickReport, all = false): string[] {
  const out = [`${r.ticks} ticks, ${r.long} kept as long (over ${r.limit.toFixed(1)} ms, or as long before them); ${r.recent.length} held`];
  const kinds = new Map<string, { n: number; ms: number }>();
  const own = new Float64Array(r.parts.length);
  for (const t of r.recent) {
    const m = measure(r.limit, t);
    const k = kinds.get(m.whose) ?? { n: 0, ms: 0 };
    k.n++;
    k.ms += m.ms;
    kinds.set(m.whose, k);
    if (m.whose === "own") t.parts.forEach((v, i) => (own[i] += v));
  }
  const total = [...kinds.values()].reduce((a, k) => a + k.ms, 0);
  const names = { own: "the server's own", core: "waiting for a core", page: "waiting for pages" } as const;
  out.push("by kind: " + ([...kinds] as [keyof typeof names, { n: number; ms: number }][]).map(([k, v]) => `${names[k]} ${v.n} ticks, ${v.ms.toFixed(0)} ms (${((100 * v.ms) / Math.max(1, total)).toFixed(0)}%)`).join("; "));
  const ownTotal = own.reduce((a, b) => a + b, 0);
  if (ownTotal > 0) out.push("the server's own, by part: " + r.parts.map((p, i) => [p, own[i]!] as const).filter(([, v]) => v >= 0.005 * ownTotal).sort((a, b) => b[1] - a[1]).map(([p, v]) => `${p} ${((100 * v) / ownTotal).toFixed(0)}%`).join(", "));
  for (const t of all ? r.recent : r.recent.slice(-20)) {
    const m = measure(r.limit, t);
    out.push(`  ${new Date(t.at).toISOString().slice(11, 23)} tick ${t.tick}: ${t.ms.toFixed(0)} ms, late ${t.late.toFixed(0)}; ${names[m.whose]}, CPU ${m.cpu.toFixed(0)} ms, page-ins ${m.pageIns}, preempted ${m.preempted}; ${partsText(t)}`);
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
