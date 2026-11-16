import { parseNumber } from "../../shared/console.ts";
import type { SpeciesDef } from "../../shared/content/defs.ts";
import { MODE_FLY, MODE_GHOST, MODE_WALK } from "../../shared/sim/character.ts";
import { Genome, POINT_CAP, STAT_NAMES } from "../../shared/sim/genome.ts";
import { FLAG_BLUEPRINT, QUALITY_NAMES } from "../../shared/sim/items.ts";
import { lootCommands } from "./loot.ts";
import { groundUnder } from "../../shared/world/collide.ts";
import { placeFree } from "../place.ts";
import { named, type Console, type ConsoleCommand } from "../console.ts";
import { V_HEALTH } from "../../shared/sim/vitals.ts";
import { CAUSE_KILLED, statOf } from "../survival.ts";
import { RESULT_OK } from "../../shared/net/protocol.ts";
import type { Client } from "../game.ts";
import type { Host } from "../host.ts";

const needsBody = "this needs a body; you have none right now";

/**
 * A vehicle parked ahead of `c`, nose away, four metres past its own reach (a rotor's sweep, a tail), where it fits: a
 * boat only on water. `said` is what was parked and where, or why not.
 */
export function parkAhead(host: Host, c: Client, kind: number, team: number): { e: number; said: string } {
  const reg = host.world.reg;
  const vehicle = reg.vehicle[kind]!;
  const id = reg.ids[kind]!;
  const a = (c.heldYaw / 65536) * 2 * Math.PI;
  const at = 4 + Math.max(vehicle.spec.halfLength, ...("rotors" in vehicle ? vehicle.rotors.map((r) => Math.hypot(r.at[0], r.at[2]) + r.radius) : []));
  const e = host.spawnVehicle(id, c.body.x + Math.sin(a) * at, c.body.z + Math.cos(a) * at, team, a);
  return { e, said: e < 0 ? `no room for ${id} ${Math.round(at)} m ahead${vehicle.movement === "boat" ? ", or no water there" : ""}` : `${id} ${Math.round(at)} m ahead` };
}

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
      name: "fly",
      usage: "",
      help: "Fly over anything, as fast as a ghost, but not through the ground or anything in the world. walk ends it.",
      admin: true,
      run(ctx) {
        const c = ctx.client;
        if (!c || c.ent < 0) return needsBody;
        const world = ctx.host.world;
        const ents = world.ents;
        const e = c.ent;
        if (ents.mode[e] === MODE_FLY) return "you are flying already";
        const p = world.reg.move[ents.kind[e]!]!;
        if (!placeFree(world, ents.x[e]!, ents.y[e]!, ents.z[e]!, p.radius, p.height)) return "you are inside something, or have no room to stand; move to open space first";
        ents.mode[e] = MODE_FLY;
        ents.vx[e] = ents.vy[e] = ents.vz[e] = 0;
        return "flying";
      },
    },
    {
      name: "walk",
      usage: "",
      help: "Leave ghost mode or flight, and fall as anyone does. Refused while you are inside something.",
      admin: true,
      run(ctx) {
        const c = ctx.client;
        if (!c || c.ent < 0) return needsBody;
        const world = ctx.host.world;
        const ents = world.ents;
        const e = c.ent;
        const was = ents.mode[e];
        if (was !== MODE_GHOST && was !== MODE_FLY) return "you are neither a ghost nor flying";
        const p = world.reg.move[ents.kind[e]!]!;
        if (!placeFree(world, ents.x[e]!, ents.y[e]!, ents.z[e]!, p.radius, p.height)) return "you are inside something; move to open space first";
        ents.mode[e] = MODE_WALK;
        ents.vx[e] = ents.vy[e] = ents.vz[e] = 0;
        return was === MODE_GHOST ? "ghost off" : "flying off";
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
      examples: ["setstat health 10"],
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
      usage: "<item> [count] [quality] [bp]",
      examples: ["give core:spear 1", "give core:spear 1 apprentice bp"],
      help: `Create items in your inventory. The item may be named without its pack: spear for core:spear. The quality is a name or its number from 0: ${QUALITY_NAMES.join(", ")}. bp makes each a blueprint of the item.`,
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
        // What follows the count is a quality, "bp", or both.
        let quality = 0;
        let bp = false;
        for (const word of args.slice(2)) {
          const w = word.toLowerCase();
          const q = QUALITY_NAMES.indexOf(w) >= 0 ? QUALITY_NAMES.indexOf(w) : /^\d+$/.test(w) ? Number(w) : -1;
          if (w === "bp") bp = true;
          else if (q >= 0 && q < QUALITY_NAMES.length) quality = q;
          else return `"${word}" is no quality (${QUALITY_NAMES.map((n, i) => `${i} ${n}`).join(", ")}) and not bp`;
        }
        if (bp && reg.blueprints[item] === 0) return `${reg.ids[item]} cannot be a blueprint: only an item that is crafted can`;
        const made = ctx.host.items.mint(rec, item, count, quality, 0, -1, "given", bp ? FLAG_BLUEPRINT : 0);
        const what = `${reg.ids[item]}${bp ? " blueprint" : ""}${quality > 0 || bp ? ` (${QUALITY_NAMES[quality]})` : ""}`;
        return made === count ? `gave ${made} ${what}` : `gave ${made} ${what}; ${count - made} did not fit`;
      },
    },
    {
      name: "spawn",
      usage: "<species> [level] [count]",
      examples: ["spawn core:raptor 30 3"],
      help: "Put a wild creature four metres in front of you, or up to 64 of them in a flock from there. It may be named without its pack: raptor for core:raptor.",
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
        const count = args[2] === undefined ? 1 : parseNumber(args[2]);
        if (!Number.isInteger(count) || count < 1 || count > 64) return "count must be a whole number from 1 to 64";
        const a = (c.heldYaw / 65536) * 2 * Math.PI;
        if (reg.vehicle[kind]) {
          if (count !== 1) return "a vehicle is spawned one at a time";
          const parked = parkAhead(ctx.host, c, kind, 0);
          return parked.e < 0 ? parked.said : `spawned ${parked.said}`;
        }
        // A flock is a disc of them about two metres apart, its near edge four metres ahead.
        const spread = count === 1 ? 0 : 2 * Math.sqrt(count);
        let e = -1;
        let made = 0;
        for (let k = 0; k < count; k++) {
          const r = count === 1 ? 0 : 2 * Math.sqrt(k + 0.5);
          const turn = k * 2.39996;
          const at = 4 + spread;
          const one = ctx.host.spawnCreature(id, c.body.x + Math.sin(a) * at + Math.sin(turn) * r, c.body.z + Math.cos(a) * at + Math.cos(turn) * r, level, "admin");
          if (one >= 0) [e, made] = [one, made + 1];
        }
        if (e < 0) return "no room for it there";
        return count === 1 ? `spawned ${id} level ${world.ents.level[e]}` : `spawned ${made} of ${count} ${id} level ${level}`;
      },
    },
    {
      name: "driver",
      usage: "[vehicle]",
      examples: ["driver", "driver helicopter"],
      help: "Park a car ahead as spawn does, nobody's, with a civilian getting in at its wheel: someone to pull out of it. A compact unless another vehicle is named; a boat is boarded from the water and is not one.",
      admin: true,
      run(ctx, args) {
        const c = ctx.client;
        if (!c) return needsBody;
        const host = ctx.host;
        const reg = host.world.reg;
        const kind = named(reg, args[0] ?? "compact", "species");
        if (typeof kind === "string") return kind;
        const vehicle = reg.vehicle[kind];
        const seat = vehicle?.seats.find((s) => s.driver);
        if (!vehicle || !seat) return `${reg.ids[kind]} is not a vehicle`;
        if (vehicle.movement === "boat") return "a boat is boarded from the water: spawn it, and a civilian";
        const who = reg.index.get("core:civilian")!;
        const parked = parkAhead(host, c, kind, 0);
        if (parked.e < 0) return parked.said;
        const door = [0, 0, 0];
        host.urban.door(parked.e, seat, reg.move[who]!.radius, door);
        const e = host.spawnCreature("core:civilian", door[0]!, door[2]!, 1, "admin");
        if (e < 0 || host.urban.seatNpc(e, parked.e, seat.id) !== RESULT_OK) return `spawned ${parked.said}; no civilian could get in at its door`;
        return `spawned ${parked.said}, a civilian getting in at its wheel`;
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
      examples: ["addxp 100"],
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
  con.add(...commands, ...lootCommands());
}
