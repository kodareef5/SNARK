// The admin page's Cast panel (client/admin/cast.ts): what Cast is doing, as JSON, and what an admin may do to it.
//
//   GET  /admin/cast.json   its settings, counts, cost, regions, stories, featured people, the last decisions, the scenes
//   POST /admin/cast        {"op":"set","name":"CastActivity","value":"1.5"}   a Cast setting, live, until a restart
//                           {"op":"spawn","scene":"cast:flash_mob"}           a scene now, near the first survivor online
//                           {"op":"retire","story":"s12"}                     a story ends; its people walk off unseen

import type { Host } from "../host.ts";
import type { Story } from "../../shared/cast/state.ts";
import { PAGE_ACTOR, type Actor } from "../acts.ts";
import { rowOf } from "../settings/catalog.ts";

/** Stories and people the panel lists at most, the newest and the most recently met first. */
const MOST_STORIES = 300, MOST_PEOPLE = 120;
/** Letters of a setting's value that its act keeps at the most. */
const VALUE_SHOWN = 80;

export function castState(host: Host, now: number): string {
  const ch = host.cast, cast = ch.cast, w = cast.world;
  const tick = host.world.tick;
  const stories = [...cast.stories.values()].sort((a, b) => b.made - a.made).slice(0, MOST_STORIES).map((s) => ({
    id: s.id, scene: cast.scenes.get(s.scene)?.name ?? s.scene, sceneId: s.scene, phase: s.phase, x: Math.round(s.x), z: Math.round(s.z), people: s.parts.length,
    choices: s.choices, slots: s.slots, engaged: s.engaged, importance: s.importance, age: Math.round((tick - s.made) / w.rate), history: s.history.slice(-3),
  }));
  const people = [...cast.people.byId.values()].filter((c) => c.tier === "featured").sort((a, b) => b.touched - a.touched).slice(0, MOST_PEOPLE).map((c) => ({
    id: c.id, name: c.name, kind: cast.people.archetype(c.archetype)?.name ?? c.archetype, want: c.want, struggle: c.struggle, hope: c.hope, dead: !!c.dead,
    story: c.story ?? null, traits: c.traits, facts: c.facts.slice(-4).map((f) => f.text), knows: Object.fromEntries(Object.entries(c.relations).map(([n, r]) => [n, { stance: r.stance, met: r.met, notes: r.notes.slice(-2) }])),
  }));
  const regions = [...cast.regions.byIndex.entries()].map(([i, r]) => ({ ...cast.spots.centre(i), heat: Math.round(r.heat * 100) / 100, players: r.players, pace: r.pace }));
  return JSON.stringify({
    enabled: cast.settings.enabled, settings: cast.settings, size: { x: w.sizeX, z: w.sizeZ },
    counts: { ...cast.counts, ...ch.stage.counts, bodies: ch.stage.count, people: cast.people.byId.size, stories: cast.stories.size },
    planner: { ...ch.planner.counts, ...ch.gate.counts, hour: ch.gate.thisHour(now), model: ch.gate.ask ? cast.settings.model : "" },
    players: w.players().map((p) => ({ name: p.name, x: Math.round(p.x), z: Math.round(p.z) })),
    regions, stories, people,
    decisions: ch.log.kept.slice(-25).reverse().map((d) => ({ t: d.t, point: d.point, policy: d.policy, why: d.why, choice: d.choice })),
    scenes: cast.cat.scenes.map((s) => ({ id: s.id, name: s.name, weight: s.weight, placeholder: !!s.placeholder, needs: s.needs, ok: s.needs.every((n) => cast.can.has(n)) })),
  });
}

/** Carries out an admin's action, and writes an act as `by` for what it changed; "" when done, else why not. */
export function castAct(host: Host, body: unknown, by: Actor = PAGE_ACTOR): string {
  const ch = host.cast, cast = ch.cast;
  const b = (body ?? {}) as { op?: unknown; name?: unknown; value?: unknown; scene?: unknown; story?: unknown };
  if (b.op === "set") {
    // A setting is named in any case, so its key is known by the row, not by the spelling.
    const row = typeof b.name === "string" ? rowOf(b.name) : undefined;
    if (!row || !row.name.startsWith("Cast") || row.secret) return "only Cast's settings, and never its key";
    const words = String(b.value ?? "");
    const why = host.setSetting(row.name, words);
    const shown = words.replace(/\s+/g, " ").trim();
    if (why === "") host.acts.write(by, `setting ${row.name} ${shown.length > VALUE_SHOWN ? `${shown.slice(0, VALUE_SHOWN)}…` : shown}`);
    return why;
  }
  if (b.op === "retire") {
    const s = typeof b.story === "string" ? cast.stories.get(b.story) : undefined;
    if (!s) return "no such story";
    if (s.phase === "done") return "";
    cast.finish(s, host.world.tick);
    host.acts.write(by, `retired Cast's story ${s.id} (${cast.scenes.get(s.scene)?.name ?? s.scene})`);
    return "";
  }
  if (b.op === "spawn") {
    const sc = typeof b.scene === "string" ? cast.scenes.get(b.scene) : undefined;
    if (!sc) return "no such scene";
    if (!sc.needs.every((n) => cast.can.has(n))) return `${sc.name} needs what Cast cannot do yet (${sc.needs.filter((n) => !cast.can.has(n)).join(", ")})`;
    const p = cast.world.players()[0];
    if (!p) return "nobody is online to play it for";
    const region = cast.spots.regionAt(p.x, p.z);
    // Any spot of its kind in sight of the survivor, else its own place.
    let spot = -1;
    for (const i of [...cast.spots.tagged(region, sc.place.tags)]) {
      const s = cast.spots.all[i]!, d = Math.hypot(s.x - p.x, s.z - p.z);
      if (d > 30 && d < 160) (spot = i);
    }
    if (spot < 0) spot = cast.spots.add({ x: p.x + 40, z: p.z + 40, tags: sc.place.tags, cap: 60 });
    const at = cast.spots.all[spot]!;
    const choices: Record<string, string> = {};
    for (const [k, os] of Object.entries(sc.choices ?? {})) choices[k] = os[0]!;
    const story: Story = { id: `a${host.world.tick}`, scene: sc.id, spot, x: at.x, z: at.z, region, phase: "planned", parts: [], choices, slots: {}, for: [], engaged: [], importance: 0.5, made: host.world.tick, since: host.world.tick, planned: -Infinity, history: ["asked for on the admin page"] };
    cast.stories.set(story.id, story);
    cast.wake(story, host.world.tick, cast.world.players());
    // A story with no room yet stays planned, and may start later.
    const waits = story.phase === "planned";
    host.acts.write(by, `${waits ? "planned" : "started"} Cast's scene ${sc.name} near ${p.name} (story ${story.id})${waits ? ", to start when there is room" : ""}`);
    return waits ? "no room for its people now (the body caps)" : "";
  }
  return "unknown op";
}
