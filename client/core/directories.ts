// The server list's results from the directories a world names (server/directory.ts). Worlds list themselves by
// announcing to a directory, so a title only searches. The title fetches; this keeps what can be joined and merges.
import { listing, type Listed } from "../../shared/listing.ts";

export interface Listing extends Listed {
  address: string;
  mapId: string;
  online: boolean;
}
/** A world's public address as a listing must give it: HTTPS, by name, on the standard port, nothing but a path. */
const JOINABLE = /^https:\/\/([a-z0-9-]+\.)+[a-z]{2,}\/[^?#\s]*$/i;
/** One directory's answer, kept to the listings that can be joined, each as shared/listing.ts passes it. */
export function listingsOf(rows: unknown): Listing[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((w): Listing[] => {
    const said = w && typeof w === "object" && typeof w.address === "string" && JOINABLE.test(w.address) ? listing(w) : null;
    return said ? [{ ...said, address: w.address, mapId: typeof w.mapId === "string" ? w.mapId : "", online: w.online === true }] : [];
  });
}
/** Every directory's listings, each address once (online over offline); null if no directory answered. `null` in `got` is one that did not. */
export function mergeListings(got: readonly (Listing[] | null)[]): Listing[] | null {
  if (got.length && got.every((g) => g === null)) return null;
  const seen = new Map<string, Listing>();
  for (const list of got) for (const w of list ?? []) if (!seen.get(w.address)?.online) seen.set(w.address, w);
  return [...seen.values()];
}
