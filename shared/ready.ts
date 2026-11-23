// What a world answers at /ready.json, which a page waiting out a restart asks (client/core/waiting.ts).

export interface Ready {
  /** When this process started, in ms since 1970: another than the one a page left means the server has restarted. */
  started: number;
  /** The wire version the server speaks (shared/net/wire.ts). */
  wire: number;
  /** The wire version of the client on disk now, or null where its build does not say. A page of another is refused. */
  page: number | null;
  /** The world's map, so an answer from another world of the cluster is not taken for this one's. */
  map: string;
}
