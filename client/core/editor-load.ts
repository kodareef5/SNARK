// Build mode, the template hammer and the plans it draws are the editor, which comes as a file of its own (editor.ts),
// asked for when a piece or the hammer is first in hand or a plan is first sent: a survivor who only drives or looks
// round never fetches it. Until it has come the app has no builder and no hammer, and the plan messages the server sends
// are kept here, to be read in the order they came.

import type { Registry } from "../../shared/content/registry.ts";
import { BitReader } from "../../shared/net/codec.ts";
import { S_PLAN, S_PLAN_GONE, S_PLAN_REPORT } from "../../shared/net/protocol.ts";
import type { PieceBook } from "../../shared/world/plan.ts";
import type { Builder } from "./build.ts";
import type { Hammer } from "./hammer.ts";
import { messages } from "./readers.ts";
import type { ClientSession } from "./session.ts";

/** The item that is the template hammer. */
export const HAMMER_ITEM = "core:template_hammer";

/** What editor.ts gives. */
export interface EditorCode {
  Builder: typeof Builder;
  Hammer: typeof Hammer;
  pieceBook(reg: Registry): PieceBook;
}

let came: EditorCode | null = null;
let asked: Promise<EditorCode> | null = null;
/** The plans' reader (plans.ts), which gives itself here as it is read. */
type PlanReader = (kind: number, s: ClientSession, r: BitReader) => void;
let readPlan: PlanReader | null = null;

export function offerPlanReader(read: PlanReader): void {
  readPlan = read;
}

/** editor.ts gives itself here as it is read, so a page or a test that has read it has the editor at once. */
export function offerEditor(code: EditorCode): void {
  came = code;
}

/** The editor, if it has come. */
export function editorNow(): EditorCode | null {
  return came;
}

/** The editor, fetched once. A fetch that fails may be asked again. */
export function askEditor(): Promise<EditorCode> {
  return (asked ??= import("./editor.ts").then(
    () => came!,
    (e: unknown) => {
      asked = null;
      throw e;
    },
  ));
}

/** Whether `item` is one the editor acts on in hand: a piece that builds, or the template hammer. */
export function editsWith(reg: Registry, item: number): boolean {
  return item !== 0 && ((reg.places[item] ?? null) !== null || reg.ids[item] === HAMMER_ITEM);
}

/** The plan messages each session was sent before the editor came: kind and the bytes after it. */
const held = new WeakMap<ClientSession, [number, Uint8Array][]>();

/** Whether `s` was sent plan messages that wait for the editor. */
export function plansWaiting(s: ClientSession): boolean {
  return (held.get(s)?.length ?? 0) > 0;
}

/** Reads the plan messages `s` was sent, in order, now that the plans' reader has come. */
export function readHeldPlans(s: ClientSession): void {
  const list = held.get(s), read = readPlan;
  if (!list || !read) return;
  held.delete(s);
  const r = new BitReader();
  for (const [kind, bytes] of list) {
    r.reset(bytes);
    read(kind, s, r);
  }
}

for (const kind of [S_PLAN, S_PLAN_GONE, S_PLAN_REPORT]) {
  messages.add({
    kind,
    read(s, r) {
      if (readPlan && !held.has(s)) return readPlan(kind, s, r);
      const list = held.get(s) ?? [];
      held.set(s, list);
      list.push([kind, r.rest()]);
    },
  });
}
