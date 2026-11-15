import { parseNumber } from "../../shared/console.ts";
import type { SpeciesDef } from "../../shared/content/defs.ts";
import { MODE_GHOST, MODE_WALK } from "../../shared/sim/character.ts";
import { Genome, POINT_CAP, STAT_NAMES } from "../../shared/sim/genome.ts";
import { groundUnder } from "../../shared/world/collide.ts";
import { placeFree } from "../place.ts";
import { named, type Console, type ConsoleCommand } from "../console.ts";
import { V_HEALTH } from "../../shared/sim/vitals.ts";
import { CAUSE_KILLED, statOf } from "../survival.ts";

const needsBody = "this needs a body; you have none right now";

export function addAdminCommands(con: Console): void {
  const commands: ConsoleCommand[] = [
    {
      name: "ghost",
      usage: "",
      help: "Fly through anything. Others still see you. walk ends it.",
      admin: true,
      run(ctx) {
        const c = ctx.client;
        if (!c || c.ent < 0) return needsBody;
        ctx.host.world.ents.mode[c.ent] = MODE_GHOST;
        return "ghost on";
      },
    },
    {
      name: "walk",
      usage: "",
      help: "Leave ghost mode. Refused while you are inside something.",
      admin: true,
      run(ctx) {
        const c = ctx.client;
        if (!c || c.ent < 0) return needsBody;
        const world = ctx.host.world;
        const ents = world.ents;
        const e = c.ent;
        if (ents.mode[e] !== MODE_GHOST) return "you are not a ghost";
        const p = world.reg.move[ents.kind[e]!]!;
        if (!placeFree(world, ents.x[e]!, ents.y[e]!, ents.z[e]!, p.radius, p.height)) return "you are inside something; move to open space first";
        ents.mode[e] = MODE_WALK;
        ents.vx[e] = ents.vy[e] = ents.vz[e] = 0;
        return "ghost off";
      },
    },
    {
      name: "tp",
      usage: "<x> [y] <z>",
      help: "Teleport. Without y you land on the ground.",
      admin: true,
      run(ctx, args) {
        const c = ctx.client;
        if (!c) return needsBody;
        const world = ctx.host.world;
        const x = parseNumber(args[0]);
        const z = parseNumber(args[args.length === 3 ? 2 : 1]);
        if (args.length < 2 || args.length > 3 || Number.isNaN(x) || Number.isNaN(z)) return "usage: tp <x> [y] <z>";
        if (x < 0 || z < 0 || x > world.hf.sizeX || z > world.hf.sizeZ) return `outside the map (0..${world.hf.sizeX}, 0..${world.hf.sizeZ})`;
        const y = args.length === 3 ? parseNumber(args[1]) : world.hf.heightAt(x, z);
        if (Number.isNaN(y)) return "usage: tp <x> [y] <z>";
        if (c.ent < 0) {
          // A spectator's body is private, so it is moved directly.
          c.body.x = x;
          c.body.y = y;
          c.body.z = z;
          return `at ${x} ${y.toFixed(2)} ${z}`;
        }
        const ents = world.ents;
        const e = c.ent;
        const p = world.reg.move[ents.kind[e]!]!;
        // Without a height given, it stands on the ground there, which on a slope is above the ground under its middle.
        const at = args.length === 3 ? y : groundUnder(world.hf, x, z, p.radius);
        if (ents.mode[e] !== MODE_GHOST && !placeFree(world, x, at, z, p.radius, p.height)) return "that spot is inside something";
        ents.setPosition(e, x, at, z);
        ents.vx[e] = ents.vy[e] = ents.vz[e] = 0;
        return `at ${x} ${at.toFixed(2)} ${z}`;
      },
    },
    {
      name: "setstat",
      usage: "<stat> <points>",
      help: `Set your level-up points in a stat (0 to ${POINT_CAP}). Stats: ${STAT_NAMES.join(", ")}.`,
      admin: true,
      run(ctx, args) {
        const c = ctx.client;
        const rec = c ? ctx.host.records.byPid.get(c.pid) : undefined;
        if (!c || !rec) return "this needs a survivor";
        const stat = STAT_NAMES.indexOf((args[0] ?? "") as (typeof STAT_NAMES)[number]);
        const points = parseNumber(args[1]);
        if (stat < 0) return `unknown stat; one of ${STAT_NAMES.join(", ")}`;
        if (!Number.isInteger(points) || points < 0 || points > POINT_CAP) return `points must be a whole number from 0 to ${POINT_CAP}`;
        const g = (rec.genome ??= new Genome());
        g.tamed[stat] = points;
        ctx.host.records.dirty.add(rec.pid);
        const world = ctx.host.world;
        ctx.host.refreshBody(rec);
        const value = statOf(world.reg.defs[rec.kind] as SpeciesDef, g, stat, 0);
        return `${STAT_NAMES[stat]}: ${points} points, value ${Number(value.toFixed(3))}`;
      },
    },
    {
      name: "give",
      usage: "<item> [count]",
      help: "Create items in your inventory. The item may be named without its pack: spear for core:spear.",
      admin: true,
      run(ctx, args) {
        const c = ctx.client;
        const rec = c ? ctx.host.records.byPid.get(c.pid) : undefined;
        if (!c || !rec) return "this needs a survivor";
        const reg = ctx.host.world.reg;
        const item = named(reg, args[0], "item");
        if (typeof item === "string") return item;
        const count = args[1] === undefined ? 1 : parseNumber(args[1]);
        if (!Number.isInteger(count) || count < 1 || count > 10000) return "count must be a whole number from 1 to 10000";
        const made = ctx.host.items.mint(rec, item, count, 0, 0, -1, "given");
        return made === count ? `gave ${made} ${reg.ids[item]}` : `gave ${made} ${reg.ids[item]}; ${count - made} did not fit`;
      },
    },
    {
      name: "spawn",
      usage: "<species> [level]",
      help: "Put a wild creature four metres in front of you. It may be named without its pack: raptor for core:raptor.",
      admin: true,
      run(ctx, args) {
        const c = ctx.client;
        if (!c) return needsBody;
        const world = ctx.host.world;
        const reg = world.reg;
        const kind = named(reg, args[0], "species");
        if (typeof kind === "string") return kind;
        const id = reg.ids[kind]!;
        const level = args[1] === undefined ? 1 : parseNumber(args[1]);
        if (!Number.isInteger(level) || level < 1 || level > 1000) return "level must be a whole number from 1 to 1000";
        const a = (c.heldYaw / 65536) * 2 * Math.PI;
        const e = ctx.host.spawnCreature(id, c.body.x + Math.sin(a) * 4, c.body.z + Math.cos(a) * 4, level, "admin");
        return e < 0 ? "no room for it there" : `spawned ${id} level ${world.ents.level[e]}`;
      },
    },
    {
      name: "possess",
      usage: "[off]",
      help: "Drive the creature you are looking at with your own keys, in place of your body; off gives it back.",
      admin: true,
      run(ctx, args) {
        const c = ctx.client;
        if (!c || c.ent < 0) return needsBody;
        const game = ctx.host.game;
        if (args[0] === "off" || c.drive >= 0) {
          if (c.drive < 0) return "you are driving nothing";
          game.release(c);
          return "back in your own body";
        }
        const e = ctx.host.death.target(c, 8);
        if (e < 0 || !game.take(c, e)) return "nothing in front of you that can be driven";
        return `driving ${ctx.host.world.reg.ids[ctx.host.world.ents.kind[e]!]}`;
      },
    },
    {
      name: "addxp",
      usage: "<amount>",
      help: "Give yourself experience.",
      admin: true,
      run(ctx, args) {
        const c = ctx.client;
        const rec = c ? ctx.host.records.byPid.get(c.pid) : undefined;
        if (!c || !rec) return "this needs a survivor";
        const amount = parseNumber(args[0]);
        if (!(amount > 0 && amount <= 1e6)) return "amount must be a number from 0 to 1000000";
        const prog = ctx.host.progression;
        prog.addXp(rec, amount);
        return `level ${prog.levelOf(rec.xp)}, ${Math.floor(rec.xp)} experience, ${prog.statPoints(rec)} stat points and ${prog.engramPoints(rec)} engram points to spend`;
      },
    },
    {
      name: "suicide",
      usage: "",
      help: "Die where you stand. Everything you carry is left in a cache.",
      admin: false,
      run(ctx) {
        const c = ctx.client;
        const rec = c ? ctx.host.records.byPid.get(c.pid) : undefined;
        if (!c || !rec || c.ent < 0) return needsBody;
        ctx.host.survival.gods.delete(rec.pid);
        ctx.host.survival.add(rec, V_HEALTH, -1e9, CAUSE_KILLED);
        return "";
      },
    },
    {
      name: "kill",
      usage: "",
      help: "Kill the creature or survivor you are looking at, up to 60 metres away.",
      admin: true,
      run(ctx) {
        const c = ctx.client;
        if (!c || c.ent < 0) return needsBody;
        const ents = ctx.host.world.ents;
        const hit = ctx.host.death.target(c, 60);
        const rec = hit >= 0 ? ctx.host.records.byPid.get(ents.pid[hit]!) : undefined;
        if (!rec || !rec.vitals) return "nothing alive there";
        const what = rec.name || ctx.host.world.reg.ids[rec.kind]!;
        ctx.host.survival.gods.delete(rec.pid);
        ctx.host.survival.add(rec, V_HEALTH, -1e9, CAUSE_KILLED);
        return `killed ${what}`;
      },
    },
    {
      name: "god",
      usage: "",
      help: "Take no harm, or stop taking none.",
      admin: true,
      run(ctx) {
        const c = ctx.client;
        const rec = c ? ctx.host.records.byPid.get(c.pid) : undefined;
        if (!c || !rec) return "this needs a survivor";
        const god = ctx.host.world.reg.index.get("core:god")!;
        if (ctx.host.buffs.take(rec, god)) return "god off";
        ctx.host.buffs.give(rec, god);
        return "god on";
      },
    },
  ];
  con.add(...commands);
}
