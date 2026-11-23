// The console's city: what of the map is broken, and setting it back (server/city-regrow.ts). Admin commands are journaled as typed.

import { parseNumber } from "../../shared/console.ts";
import type { ConsoleCommand } from "../console.ts";

const USAGE = "usage: city status | reset here | reset building <id> | reset radius <metres> | reset all";

export function cityCommands(): ConsoleCommand[] {
  return [
    {
      name: "city",
      usage: "status | reset here | reset building <id> | reset radius <metres> | reset all",
      help: "The map's buildings. `status` says how many are harmed, in doubt and coming down. `reset` sets what is broken back as the map placed it, now and whoever is near: `here` the building you stand in or nearest, `building` the one of an id (the prompt on a piece says its building), `radius` every one with a broken piece within that many metres of you, `all` the whole city. A building that is coming down is left to finish.",
      examples: ["city status", "city reset here", "city reset radius 200", "city reset all"],
      admin: true,
      run(ctx, args) {
        const { world, records, cityRegrow, cityCollapse } = ctx.host;
        if (args[0] === "status") {
          const changed = world.structs.held.reduce((n, chunk) => n + world.structs.chunks[chunk]!.changed, 0);
          return `${changed} pieces of the map are not as placed; ${cityRegrow.kept} buildings and chunks wait to return, ${cityCollapse.waiting} buildings are in doubt and ${cityCollapse.falling} coming down${world.buildings ? "" : "; this map holds no buildings"}`;
        }
        if (args[0] !== "reset") return USAGE;
        const said = (r: { buildings: number; slots: number }): string => `${r.slots} pieces set back, of ${r.buildings} buildings`;
        if (args[1] === "all") return said(cityRegrow.reset());
        if (args[1] === "building") {
          const id = parseNumber(args[2]);
          if (!world.buildings || !(id >= 0) || world.buildings.byId(id) < 0) return `no building "${args[2] ?? ""}"`;
          if (cityCollapse.doubted(id)) return "that building is coming down";
          return `${cityRegrow.heal(id, true)} pieces set back`;
        }
        const body = ctx.client ? records.byPid.get(ctx.client.pid) : undefined;
        const e = body ? records.entOf.get(body.pid) : undefined;
        if (e === undefined) return "this needs a survivor in the world";
        const [x, z] = [world.ents.x[e]!, world.ents.z[e]!];
        if (args[1] === "radius") {
          const radius = parseNumber(args[2]);
          return radius > 0 ? said(cityRegrow.reset(x, z, radius)) : USAGE;
        }
        if (args[1] !== "here") return USAGE;
        // The building of the nearest broken piece within a chunk's width.
        let near = -1, best = 64 * 64;
        const { dims, structs } = world;
        const cx = Math.floor(x / 64), cz = Math.floor(z / 64);
        for (let nz = Math.max(0, cz - 1); nz <= Math.min(dims.chunksZ - 1, cz + 1); nz++) {
          for (let nx = Math.max(0, cx - 1); nx <= Math.min(dims.chunksX - 1, cx + 1); nx++) {
            const chunk = nz * dims.chunksX + nx, t = structs.chunks[chunk];
            for (const slot of t ? structs.changedSlots(chunk) : []) {
              const d = (t!.x[slot]! - x) * (t!.x[slot]! - x) + (t!.z[slot]! - z) * (t!.z[slot]! - z);
              const handle = world.buildings?.buildingOf(chunk, slot) ?? -1;
              if (handle >= 0 && d < best) [near, best] = [world.buildings!.id(handle), d];
            }
          }
        }
        if (near < 0) return "no building near is broken";
        if (cityCollapse.doubted(near)) return "that building is coming down";
        return `${cityRegrow.heal(near, true)} pieces set back, of building ${near}`;
      },
    },
  ];
}
