// The lists of the map's own pieces gone as a client holds them (S_GONE): per chunk told of, its map slots that no longer
// stand. The far city leaves those out of what it draws (render/farcity.ts). A list is kept for the connection whether or
// not the map's statics of its chunk have come yet, so it is there when they do.

import type { MapDims } from "../../shared/coords.ts";
import type { BitReader } from "../../shared/net/codec.ts";
import { S_GONE } from "../../shared/net/protocol.ts";
import { GoneList, readGone } from "../../shared/world/gone.ts";
import { messages } from "./readers.ts";

export class GoneStore {
  /** A chunk never told of has no entry. One told that every piece stands again has an empty list. */
  readonly lists = new Map<number, Uint16Array>();
  /**
   * Counts the messages that changed a chunk's list. `changed` holds that count per chunk at its last change, as
   * FarStore.changed does, and `told` the server's version of the list held.
   */
  version = 0;
  changed = new Uint32Array(0);
  told = new Uint32Array(0);
  private readonly got = new GoneList();

  /** S_GONE after its type. */
  read(r: BitReader, dims: MapDims): void {
    const got = this.got;
    const chunk = readGone(r, got);
    const count = dims.chunksX * dims.chunksZ;
    if (chunk < 0 || chunk >= count) return;
    if (this.changed.length !== count) {
      this.changed = new Uint32Array(count);
      this.told = new Uint32Array(count);
    }
    if (this.lists.has(chunk) && this.told[chunk] === got.version) return;
    this.lists.set(chunk, got.slots);
    this.told[chunk] = got.version;
    this.changed[chunk] = ++this.version;
  }
}

messages.add({
  kind: S_GONE,
  read(s, r) {
    if (s.world) s.gone.read(r, s.world.dims);
  },
});
