// A second process saving one named person over and over, each save made from the revision it last read and each
// refused one read again and tried: bun tests/fixtures/people-saver.ts <db> <media> <id> <count> <name>. Prints the
// revisions it was given and how many saves were refused.
import { PeopleStore } from "../../server/people/store.ts";
import type { PersonDoc } from "../../shared/people/doc.ts";

const [db, media, id, count, name] = process.argv.slice(2) as [string, string, string, string, string];
const store = new PeopleStore({ db, media });
const revs: number[] = [];
let refused = 0;
for (let k = 0; k < Number(count); ) {
  const held = store.view().records.person.get(Number(id))!;
  const doc: PersonDoc = { name: "Mara", look: { seed: 7, population: "core:people_city", revision: 1, locks: {} }, outfit: null, wardrobe: null, notes: `${name} ${k}` };
  const done = store.save("person", Number(id), held[held.length - 1]!.rev, doc, { name, id: "" });
  if ("status" in done) {
    if (done.status !== 409 && done.status !== 503) throw new Error(done.error);
    refused++;
    continue;
  }
  revs.push(done.rev);
  k++;
}
store.close();
console.log(JSON.stringify({ revs, refused }));
