// Child process for the crash test. It prints "acked <seq>" only once the commit has returned, and the parent kills it without warning.
// Usage: bun tests/fixtures/crash-child.ts <db path> <seed>

import { writeSync } from "node:fs";
import { DEADLINE_BREED } from "../../server/breeding.ts";
import { createHost } from "../../server/host.ts";
import { BitWriter } from "../../shared/net/codec.ts";
import { RESULT_OK } from "../../shared/net/protocol.ts";
import { Rng } from "../../shared/rng.ts";
import { rollWild } from "../../shared/sim/genome.ts";
import { coreRegistry } from "./world.ts";

export const HOLDERS = 8;
export const START = 1000;
export const OP_TRANSFER = 1;
export const OP_MINT = 11;
export const OP_BURN = 12;

/** The "death" mode. Survivors die, are looted and return, with each step committed and acknowledged like the trades. */
function deathLoop(dbPath: string, seed: number): never {
  const reg = coreRegistry();
  const host = createHost(reg, { dbPath });
  const p = host.persistence!;
  const stone = reg.index.get("core:stone")!;
  const berry = reg.index.get("core:berry")!;
  const survivor = reg.index.get("core:survivor")!;
  if (host.loaded!.fresh) {
    for (let i = 0; i < HOLDERS; i++) {
      const rec = host.records.create(survivor, `mortal${i}`);
      p.bindSurvivor(rec.name, rec.pid);
      host.items.mint(rec, stone, 300);
      host.items.mint(rec, berry, 40);
    }
    p.commit();
  }
  const rng = new Rng(seed);
  const survivors = [...p.survivors.values()].map((pid) => host.records.byPid.get(pid)!);
  writeSync(1, "ready\n");
  for (;;) {
    for (let n = 1 + rng.int(4); n > 0; n--) {
      const rec = survivors[rng.int(survivors.length)]!;
      const caches = [...host.records.byPid.values()].filter((r) => r.expiresAt > 0);
      const k = rng.int(4);
      if (k === 0 && !rec.dead) host.death.die(rec, 1 + rng.int(5));
      else if (k === 1 && rec.dead) {
        // There is no session here, so this does by hand what a respawn does to the record.
        rec.dead = false;
        host.records.dirty.add(rec.pid);
      } else if (k === 2 && caches.length > 0 && !rec.dead) {
        const cache = caches[rng.int(caches.length)]!;
        const inv = host.items.inv(cache);
        for (let s = 0; s < inv.cap; s++) if (inv.item[s] !== 0 && rng.int(2) === 0) host.items.give(cache, rec, inv.item[s]!, inv.count[s]!);
        if (host.items.inv(cache).used() === 0) host.death.remove(cache);
      } else if (k === 3 && !rec.dead) host.items.mint(rec, rng.int(2) === 0 ? stone : berry, 1 + rng.int(30));
    }
    host.world.tick += 1 + rng.int(40);
    p.commit();
    writeSync(1, `acked ${p.durableSeq + p.commits}\n`);
  }
}

/** Journal ops of the "eggs" mode: a creature went, a fertilised egg was laid, one was taken up, set down, eaten. */
export const OP_GO = 31;
export const OP_LAID = 32;
export const OP_TAKE = 33;
export const OP_PUT = 34;
export const OP_EAT = 35;

/**
 * The "eggs" mode. Female dodos defecate and lay, fertilised eggs are laid, and the dodos take eggs up, set them down,
 * eat them and pass them on; time passes, so eggs hatch and what lies decomposes. Each step is committed and acknowledged.
 */
function eggLoop(dbPath: string, seed: number): never {
  const reg = coreRegistry();
  const host = createHost(reg, { dbPath });
  const p = host.persistence!;
  const { records, items, eggs } = host;
  const dodo = reg.index.get("core:dodo")!;
  const prop = reg.index.get("core:egg_dodo")!;
  const rng = new Rng(seed);
  if (host.loaded!.fresh) {
    const [cx, cz] = host.world.zones[0]!.at;
    for (let made = 0, tries = 0; made < HOLDERS && tries < 1000; tries++) {
      const e = host.spawnCreature("core:dodo", cx + rng.range(-15, 15), cz + rng.range(-15, 15), 5);
      if (e < 0) continue;
      records.byPid.get(host.world.ents.pid[e]!)!.genome!.female = true;
      made++;
    }
    p.commit();
  }
  const w = new BitWriter(8);
  const note = (op: number): void => {
    w.reset();
    w.u8(op);
    p.journal(op, w.bytes());
  };
  writeSync(1, "ready\n");
  for (;;) {
    const dodos = [...records.byPid.values()].filter((r) => r.kind === dodo && records.entOf.has(r.pid));
    for (let n = 1 + rng.int(5); n > 0 && dodos.length > 0; n--) {
      const rec = dodos[rng.int(dodos.length)]!;
      const e = records.entOf.get(rec.pid)!;
      const inv = items.inv(rec);
      const held: number[] = [];
      for (let s = 0; s < inv.cap; s++) if (inv.item[s] !== 0 && eggs.propOfItem(inv.item[s]!) !== 0) held.push(s);
      const k = rng.int(6);
      if (k === 0) {
        if (host.feces.go(rec, e)) note(OP_GO);
      } else if (k === 1) {
        const egg = records.create(prop, "dodo egg");
        egg.genome = rollWild(rng, 5, reg.colorSet[dodo]!);
        egg.x = host.world.ents.x[e]! + rng.range(-2, 2);
        egg.z = host.world.ents.z[e]! + rng.range(-2, 2);
        egg.y = host.world.hf.heightAt(egg.x, egg.z);
        const span = 300 + rng.int(2000);
        egg.egg = { species: dodo, span, hatchAt: host.world.tick + span, carrier: 0 };
        host.death.place(egg);
        host.deadlines.push(egg.egg.hatchAt, DEADLINE_BREED, egg.pid, egg.egg.hatchAt);
        note(OP_LAID);
      } else if (k === 2) {
        const lying = [...records.byPid.values()].filter((r) => r.kind === prop && r.egg !== null && records.entOf.has(r.pid));
        if (lying.length > 0 && eggs.takeUp(rec, lying[rng.int(lying.length)]!) === RESULT_OK) note(OP_TAKE);
      } else if (held.length > 0) {
        const s = held[rng.int(held.length)]!;
        if (k === 3 && eggs.put(rec, s, rng.int(3)) === true) note(OP_PUT);
        else if (k === 4 && items.burn(rec, s, 1)) note(OP_EAT);
        else if (k === 5) {
          const to = dodos[rng.int(dodos.length)]!;
          const free = items.inv(to).free();
          if (to !== rec && free >= 0) items.move(rec, s, to, free, 0);
        }
      }
    }
    for (let t = 1 + rng.int(30); t > 0; t--) host.game.tick();
    // Now and then a jump, so that feces decomposes and eggs hatch between commits.
    if (rng.int(8) === 0) host.world.tick += 1 + rng.int(2500);
    p.commit();
    writeSync(1, `acked ${p.durableSeq + p.commits}\n`);
  }
}

/** Journal ops of the "balls" mode: a tame was kept in a soul ball, loosed from one, a full ball was passed on, and one was destroyed. */
export const OP_KEEP = 41;
export const OP_LOOSE = 42;
export const OP_PASS = 43;
export const OP_BREAK = 44;
/** The tames of the "balls" mode, which its test counts after each kill. */
export const BALL_TAMES = 6;

/**
 * The "balls" mode. Survivors with no session hold soul balls and own raptors: they keep them, loose them, pass full balls
 * to each other and now and then destroy one, which loses its tame. Time passes, in ticks and in jumps. Each step is
 * committed and acknowledged. A tame is named for its number, so that the test can say which are left.
 */
function ballLoop(dbPath: string, seed: number): never {
  const reg = coreRegistry();
  const host = createHost(reg, { dbPath });
  const p = host.persistence!;
  const { records, items, balls } = host;
  const [survivor, raptor, ball, full] = ["survivor", "raptor", "soul_ball", "soul_ball_full"].map((n) => reg.index.get(`core:${n}`)!) as [number, number, number, number];
  const rng = new Rng(seed);
  const [cx, cz] = host.world.zones[0]!.at;
  if (host.loaded!.fresh) {
    const holders = [];
    for (let i = 0; i < 3; i++) {
      const rec = records.create(survivor, `keeper${i}`);
      rec.team = records.newTeam();
      p.bindSurvivor(rec.name, rec.pid);
      items.mint(rec, ball, 4);
      holders.push(rec);
    }
    for (let made = 0, tries = 0; made < BALL_TAMES && tries < 1000; tries++) {
      const e = host.spawnCreature("core:raptor", cx + rng.range(-20, 20), cz + rng.range(-20, 20), 5);
      if (e < 0) continue;
      const rec = records.byPid.get(host.world.ents.pid[e]!)!;
      if (!host.taming.give(rec, holders[made % holders.length]!, 0.5, "forced")) continue;
      rec.name = `tame${made}`;
      rec.saddle = reg.index.get("core:saddle_raptor")!;
      items.mint(rec, reg.index.get("core:stone")!, 10 + made);
      made++;
    }
    p.commit();
  }
  const w = new BitWriter(8);
  const note = (op: number): void => {
    w.reset();
    w.u8(op);
    p.journal(op, w.bytes());
  };
  const holders = [...p.survivors.values()].map((pid) => records.byPid.get(pid)!);
  const slotsOf = (rec: (typeof holders)[number], item: number): number[] => {
    const inv = items.inv(rec);
    const out: number[] = [];
    for (let s = 0; s < inv.cap; s++) if (inv.item[s] === item) out.push(s);
    return out;
  };
  writeSync(1, "ready\n");
  for (;;) {
    // Nothing harms a tame here, so that one is lost only with its ball: rival tribes' raptors stand side by side, and
    // one loosed twice in five minutes is sick.
    for (const r of records.byPid.values()) if (r.kind === raptor) host.survival.gods.add(r.pid);
    for (let n = 1 + rng.int(4); n > 0; n--) {
      const me = holders[rng.int(holders.length)]!;
      const k = rng.int(10);
      if (k < 4) {
        // Keeps one of its tribe's that stands in the world.
        const mine = [...records.byPid.values()].filter((r) => r.kind === raptor && r.team === me.team && r.stored === 0 && records.entOf.has(r.pid));
        const empty = slotsOf(me, ball);
        if (mine.length > 0 && empty.length > 0 && balls.keepIn(me, empty[rng.int(empty.length)]!, records.entOf.get(mine[rng.int(mine.length)]!.pid)!) === "") note(OP_KEEP);
      } else if (k < 8) {
        const held = slotsOf(me, full);
        if (held.length > 0) {
          const x = cx + rng.range(-20, 20);
          const z = cz + rng.range(-20, 20);
          const tame = records.byPid.get(items.inv(me).refOf(held[0]!));
          if (balls.looseAt(me, held[rng.int(held.length)]!, x, host.world.hf.heightAt(x, z), z, rng.int(65536)) === "" && tame) note(OP_LOOSE);
        }
      } else if (k === 8) {
        // A full ball changes hands: whoever looses it will own its tame.
        const to = holders[rng.int(holders.length)]!;
        if (to !== me && items.give(me, to, full, 1)) note(OP_PASS);
      } else if (rng.int(6) === 0) {
        // A full ball is destroyed, and its tame with it. The ball is made again empty, so that the play goes on.
        const held = slotsOf(me, full);
        if (held.length > 0 && items.burn(me, held[0]!, 1, true)) {
          items.mint(me, ball, 1);
          note(OP_BREAK);
        }
      }
    }
    for (let t = 1 + rng.int(20); t > 0; t--) host.game.tick();
    // Now and then a jump of up to two minutes, which a kept tame does not feel. No longer: nobody here eats.
    if (rng.int(6) === 0) host.world.tick += 1 + rng.int(3600);
    p.commit();
    writeSync(1, `acked ${p.durableSeq + p.commits}\n`);
  }
}

if (import.meta.main) {
  const [dbPath, seed, mode] = process.argv.slice(2);
  if (mode === "death") deathLoop(dbPath!, Number(seed));
  if (mode === "eggs") eggLoop(dbPath!, Number(seed));
  if (mode === "balls") ballLoop(dbPath!, Number(seed));
  const reg = coreRegistry();
  const host = createHost(reg, { dbPath: dbPath! });
  const p = host.persistence!;
  const stone = reg.index.get("core:stone")!;
  const grazer = reg.index.get("core:grazer")!;
  if (host.loaded!.fresh) {
    for (let i = 0; i < HOLDERS; i++) host.items.mint(host.records.create(grazer, `holder${i}`), stone, START);
    p.commit();
  }
  const pids = [...host.records.byPid.keys()].sort((a, b) => a - b);
  const rec = (pid: number) => host.records.byPid.get(pid)!;
  const rng = new Rng(Number(seed));
  const w = new BitWriter(64);
  writeSync(1, "ready\n");
  for (;;) {
    for (let n = 1 + rng.int(6); n > 0; n--) {
      const from = pids[rng.int(HOLDERS)]!;
      const to = pids[rng.int(HOLDERS)]!;
      const count = 1 + rng.int(40);
      const kind = rng.int(8);
      w.reset();
      w.uint53(from);
      if (kind === 0) {
        const made = host.items.mint(rec(from), stone, count);
        if (made === 0) continue;
        w.varint(made);
        p.journal(OP_MINT, w.bytes());
      } else if (kind === 1) {
        if (!host.items.burnItem(rec(from), stone, count)) continue;
        w.varint(count);
        p.journal(OP_BURN, w.bytes());
      } else {
        if (!host.items.give(rec(from), rec(to), stone, count)) continue;
        w.uint53(to);
        w.varint(count);
        p.journal(OP_TRANSFER, w.bytes());
      }
    }
    host.world.tick++;
    p.commit();
    writeSync(1, `acked ${p.durableSeq}\n`);
  }
}
