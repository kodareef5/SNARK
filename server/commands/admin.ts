// Cheats that act on the caller's own body: noclip, teleport, stat points.

import { parseNumber } from "../../shared/console.ts";
import type { SpeciesDef } from "../../shared/content/defs.ts";
import { MODE_GHOST, MODE_WALK } from "../../shared/sim/character.ts";
import { Genome, POINT_CAP, STAT_NAMES } from "../../shared/sim/genome.ts";
import { capsuleFree } from "../../shared/world/collide.ts";
import type { Console, ConsoleCommand } from "../console.ts";
import { refreshMods, statOf } from "../survival.ts";

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
        if (!capsuleFree(world, ents.x[e]!, ents.y[e]!, ents.z[e]!, p.radius, p.height)) return "you are inside something; move to open space first";
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
          // A spectator's body is private: just move it.
          c.body.x = x;
          c.body.y = y;
          c.body.z = z;
          return `at ${x} ${y.toFixed(2)} ${z}`;
        }
        const ents = world.ents;
        const e = c.ent;
        const p = world.reg.move[ents.kind[e]!]!;
        if (ents.mode[e] !== MODE_GHOST && !capsuleFree(world, x, y, z, p.radius, p.height)) return "that spot is inside something";
        ents.setPosition(e, x, y, z);
        ents.vx[e] = ents.vy[e] = ents.vz[e] = 0;
        return `at ${x} ${y.toFixed(2)} ${z}`;
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
        if (c.ent >= 0) refreshMods(world.reg, world.ents, c.ent, g);
        const value = statOf(world.reg.defs[rec.kind] as SpeciesDef, g, stat, 0);
        return `${STAT_NAMES[stat]}: ${points} points, value ${Number(value.toFixed(3))}`;
      },
    },
    {
      name: "give",
      usage: "<item> [count]",
      help: "Create items in your inventory. The item may be named without its namespace.",
      admin: true,
      run(ctx, args) {
        const c = ctx.client;
        const rec = c ? ctx.host.records.byPid.get(c.pid) : undefined;
        if (!c || !rec) return "this needs a survivor";
        const reg = ctx.host.world.reg;
        const item = reg.index.get(args[0] ?? "") ?? reg.index.get(`core:${args[0]}`);
        if (item === undefined || !ctx.host.items.isItem(item)) return `no item "${args[0] ?? ""}"`;
        const count = args[1] === undefined ? 1 : parseNumber(args[1]);
        if (!Number.isInteger(count) || count < 1 || count > 10000) return "count must be a whole number from 1 to 10000";
        const made = ctx.host.items.mint(rec, item, count);
        return made === count ? `gave ${made} ${reg.ids[item]}` : `gave ${made} ${reg.ids[item]}; ${count - made} did not fit`;
      },
    },
    {
      name: "spawn",
      usage: "<species> [level]",
      help: "Put a wild creature four metres in front of you.",
      admin: true,
      run(ctx, args) {
        const c = ctx.client;
        if (!c) return needsBody;
        const world = ctx.host.world;
        const reg = world.reg;
        const id = reg.index.has(args[0] ?? "") ? args[0]! : `core:${args[0]}`;
        const kind = reg.index.get(id);
        if (kind === undefined || reg.defs[kind]!.type !== "species") return `no species "${args[0] ?? ""}"`;
        const level = args[1] === undefined ? 1 : parseNumber(args[1]);
        if (!Number.isInteger(level) || level < 1 || level > 1000) return "level must be a whole number from 1 to 1000";
        const a = (c.heldYaw / 65536) * 2 * Math.PI;
        const e = ctx.host.spawnCreature(id, c.body.x + Math.sin(a) * 4, c.body.z + Math.cos(a) * 4, level);
        return e < 0 ? "no room for it there" : `spawned ${id} level ${world.ents.level[e]}`;
      },
    },
  ];
  con.add(...commands);
}
