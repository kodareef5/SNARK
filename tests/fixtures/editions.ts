// A garment edition for a test's host: the one its people store holds by that name, or one published there now.
import type { Host } from "../../server/host.ts";

/** The id of an edition of `garment` named `name` in the host's people store, published there if it has none. */
export function editionOf(host: Host, garment: string, name = `test ${garment.slice(garment.indexOf(":") + 1)}`, colours: [number, number, number] = [0, 0, 0]): number {
  const view = host.people.view();
  const kept = view.editions.find((e) => e.garment === garment && e.name === name);
  if (kept) return kept.id;
  const done = host.people.publish(view.revision, { garment, colours, print: null, name }, { name: "(test)", id: "" });
  if ("status" in done) throw new Error(done.error);
  return done.id;
}
