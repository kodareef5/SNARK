import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

/** Builds the operator pages separately from the playable client and its art. */
export async function buildAdmin(dist: string): Promise<void> {
  const client = resolve(import.meta.dir, "../client");
  const out = join(dist, "admin");
  mkdirSync(out, { recursive: true });
  const emblem = join(client, "entry/media/snark-emblem.webp");
  if (existsSync(emblem)) {
    mkdirSync(join(dist, "title"), { recursive: true });
    copyFileSync(emblem, join(dist, "title/snark-emblem.webp"));
  }
  const entries = ["shell", "cluster", "admin", "settings", "cast", "loadouts", "events", "first-frame", "board", "screens", "screens-stage", "permissions", "acts"];
  const result = await Bun.build({
    entrypoints: [...entries.map(name => join(client, "admin", name + ".ts")), join(client, "drops/drops.ts")],
    outdir: out, naming: "[name].[ext]", target: "browser", minify: true, sourcemap: "linked",
  });
  if (!result.success) throw Error(result.logs.map(String).join("\n"));
  for (const page of ["cluster", "cast", "loadouts", "events", "settings", "first-frame", "screens", "permissions", "acts"])
    copyFileSync(join(client, "admin", page + ".html"), join(out, page + ".html"));
  for (const css of ["admin.css", "investigate.css", "overview.css"])
    copyFileSync(join(client, "admin", css), join(out, css));
  copyFileSync(join(client, "admin/admin.html"), join(out, "index.html"));
  copyFileSync(join(client, "drops/drops.html"), join(out, "drops.html"));
  copyFileSync(join(client, "sound/sounds.html"), join(out, "sounds.html"));
}
if (import.meta.main) await buildAdmin(resolve(process.argv[2] ?? "client/dist"));
