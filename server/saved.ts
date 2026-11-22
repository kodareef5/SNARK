// What a feature saves on each record. Its own file declares the component with `saved({ ... })`, and the record codec
// (server/persist/codec.ts) walks every one declared: to write a record, to read one, and to move one's ticks to
// another clock. No list names them, so a new one is no line in a shared file. A codec knows the components of the
// files that are loaded, which for a server is all of them (server/host.ts); the bytes of one it does not know it keeps
// and writes back (EntityRecord.extra).

import type { BitReader, BitWriter } from "../shared/net/codec.ts";
import type { EntityRecord } from "./records.ts";

/** What a component is written and read against: the table of content ids that goes with the bytes, and what a read may report. */
export interface Coding {
  /** This build's content index as the bytes name it. */
  readonly toSaved: Uint16Array;
  /** The bytes' content index as this build's, 0 for content it lacks. */
  readonly toRuntime: Uint16Array;
  /** Content written as one thing that this build knows as several: its written index, and each of them. */
  readonly split: ReadonlyMap<number, readonly number[]>;
  /** The component being read, whole. */
  blob: Uint8Array;
  /** A read sets this to refuse the record: it is not loaded. */
  refused: boolean;
  /** A read sets this when it left out something the record's vitals count. Their rates are then worked out again. */
  stale: boolean;
  /** Slot and pid pairs a read gives for the record's inventory, put on it once every component is read. */
  readonly refs: number[];
  /** An item by its written index. One whose content is gone stops the read, or is 0 and counted with the `n` that record `pid` held. */
  item(saved: number, pid: number, n: number): number;
  /** Counts `n` of `item` as gone with something that was left out. */
  burn(item: number, n: number): void;
}

export interface Saved {
  /**
   * What a save knows the component by: the number it is saved under is made from this (savedId). No two share a name,
   * and under another name it is another component, which does not read what this one wrote.
   */
  readonly name: string;
  /** Whether the record has any of it to save. One that has none costs no bytes. */
  has(rec: EntityRecord): boolean;
  write(rec: EntityRecord, w: BitWriter, to: Coding): void;
  read(rec: EntityRecord, r: BitReader, from: Coding): void;
  /**
   * For a record that leaves one world's clock for another's `delta` ticks on (rebaseTicks): moves each world tick it
   * keeps with `moved`, and clears what is worked out from them. Called whether or not the record has any of it.
   */
  rebase?: ((rec: EntityRecord, delta: number) => void) | undefined;
}

/** A world tick on a clock `delta` ticks on: what was due is due as far off. A tick of 0 means none and stays 0. */
export function moved(tick: number, delta: number): number {
  return tick === 0 ? 0 : Math.max(1, tick + delta);
}

/** A component as declared, with the number it is saved under. */
export interface SavedRow extends Saved {
  readonly id: number;
}

/** Below this are the numbers that code keeping its own bytes in EntityRecord.extra chose by hand. */
const FIRST_ID = 128;
/** A number under this is three bytes in a save, and the three-letter tags others keep in EntityRecord.extra are above it. */
const END_ID = 1 << 21;

/**
 * The number a component of this name is saved under: a hash of the name, so it is the same on every run and every
 * branch, and two features that each add one take no line from a shared list. Two names that hash alike are refused
 * as the second is declared.
 */
export function savedId(name: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) hash = Math.imul(hash ^ name.charCodeAt(i), 0x01000193);
  return FIRST_ID + ((hash >>> 0) % (END_ID - FIRST_ID));
}

const rows: SavedRow[] = [];
const byId = new Map<number, SavedRow>();

/** Every component declared, by rising number: the order a record is written in. */
export const SAVED: readonly SavedRow[] = rows;

/** Declares a component. Call it once, as the feature's file loads. */
export function saved(part: Saved): SavedRow {
  // Every row has one shape, which keeps the codec's walk over them cheap.
  const row: SavedRow = { name: part.name, id: savedId(part.name), has: part.has, write: part.write, read: part.read, rebase: part.rebase };
  const other = byId.get(row.id);
  if (other) throw new Error(other.name === row.name ? `two saved components are called "${row.name}"` : `saved components "${other.name}" and "${row.name}" are both number ${row.id}: give the new one another name`);
  byId.set(row.id, row);
  rows.push(row);
  rows.sort((a, b) => a.id - b.id);
  return row;
}

/** The component saved under a number, where one is declared. */
export function savedAs(id: number): SavedRow | undefined {
  return byId.get(id);
}
