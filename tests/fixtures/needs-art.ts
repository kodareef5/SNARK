// A test that needs the art is skipped where it is not here (ART, tools/art/source.ts), and the check says how many were.
// A file whose every test needs it takes `test` from here; a file with a few takes `artTest` for those.

import { test } from "bun:test";
import { ART } from "../../tools/art/source.ts";

export const artTest: typeof test = ART ? test : test.skip;
export { artTest as test };

/** What `make` gives where the art is here. Where it is not, nothing: for a value only the tests that need it use. */
export const fromArt = <T>(make: () => T): T => (ART ? make() : (undefined as T));
