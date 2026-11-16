// The operator's look at the cluster, and a cheat that sends a survivor to another server of it with no terminal. A player
// travels at an obelisk's terminal (planning/architecture/transfers.md).

import { auditCluster } from "../cluster/audit.ts";
import type { Console } from "../console.ts";
import { NAME_UNCLEAR, meant } from "../names.ts";

export function addClusterCommands(con: Console): void {
  con.add(
    {
      name: "travel",
      usage: "[server]",
      examples: ["travel"],
      help: "List the other servers of the cluster, or send your survivor to one with what it carries, as its terminal would.",
      admin: true,
      run(ctx, args) {
        const cluster = ctx.host.cluster;
        if (!cluster) return "this server is not part of a cluster";
        const there = cluster.destinations();
        const name = args.join(" ");
        if (name === "") {
          if (there.length === 0) return "no other server of the cluster is running";
          return there.map((d) => `${d.name} (${d.map}), ${d.players} of ${d.max}${d.why ? `: ${d.why}` : ""}`).join("\n");
        }
        if (!ctx.client) return "the operator has no survivor to send";
        const which = meant(there.map((d) => d.name), name);
        const byMap = which < 0 && which !== NAME_UNCLEAR ? meant(there.map((d) => d.map), name) : which;
        if (byMap === NAME_UNCLEAR) return `more than one server could be "${name}"; give its name exactly`;
        const to = there[byMap];
        if (!to) return `no running server of the cluster is called "${name}"`;
        const why = cluster.leave(ctx.client, to.world);
        return why === "" ? "" : why;
      },
    },
    {
      name: "cluster",
      usage: "[audit]",
      examples: ["cluster audit"],
      help: "Show this server's cluster and what has left it, or with audit, whether every item of the cluster is accounted for.",
      admin: true,
      run(ctx, args) {
        const cluster = ctx.host.cluster;
        if (!cluster) return "this server is not part of a cluster";
        if ((args[0] ?? "").toLowerCase() === "audit") return auditCluster(cluster.folder, ctx.host.world.reg).lines.join("\n");
        const out = [`cluster ${cluster.id} in ${cluster.folder.root}: this server is world ${cluster.world}`];
        for (const d of cluster.destinations()) out.push(`  world ${d.world}: ${d.name} (${d.map}), ${d.players} of ${d.max}`);
        for (const [name, a] of cluster.away) out.push(`  ${name} left for ${cluster.serverName(a.to)} by transfer ${a.id}${a.settled ? "" : ", not yet taken"}`);
        return out.join("\n");
      },
    },
  );
}
