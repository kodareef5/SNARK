// A second process publishing editions into a people store as fast as it can, each refused one tried again on the
// store as it is then: bun tests/fixtures/people-writer.ts <db> <media> <count> <name>. Prints the ids it was given.
import { PeopleStore } from "../../server/people/store.ts";

const [db, media, count, name] = process.argv.slice(2) as [string, string, string, string];
const store = new PeopleStore({ db, media });
const ids: number[] = [];
let refused = 0;
for (let k = 0; k < Number(count); ) {
  const done = store.publish(store.view().revision, { garment: "core:tee", colours: [k % 256, 0, 0], print: null, name: `${name} ${k}` }, { name, id: "" });
  if ("status" in done) {
    if (done.status !== 409 && done.status !== 503) throw new Error(done.error);
    refused++;
    continue;
  }
  ids.push(done.id);
  k++;
}
store.close();
console.log(JSON.stringify({ ids, refused }));
