// A separate preview process: accepted Koru remains on 8792 with its original map and save.
import { resolve } from "node:path";
import { startKoruPreview } from "../koru/dev.ts";
import { writeKoruSailsCourse } from "./course.ts";

export async function startKoruSailsPreview(args = process.argv.slice(2)): Promise<void> {
  const own = args.slice(), root = resolve(import.meta.dir, "../..");
  if (!own.includes("--port")) own.push("--port", "8793");
  if (!own.includes("--db")) own.push("--db", resolve(root, "var/koru-sails-preview/world.db"));
  const at = own.indexOf("--map"), map = at < 0 ? writeKoruSailsCourse() : own[at + 1]!;
  await startKoruPreview(map, own);
}

if (import.meta.main) await startKoruSailsPreview();
