import type { ClientSession } from "../../client/core/session.ts";
import { BOX_SELF, CMD_MOVE, CMD_SELECT } from "../../shared/net/protocol.ts";
import { BTN_PRIMARY } from "../../shared/sim/character.ts";
import { capsuleFree } from "../../shared/world/collide.ts";
import type { NodeSpot } from "../../shared/world/nodes.ts";
import type { Harness, Pilot } from "./net.ts";

export interface Found extends NodeSpot {
  chunk: number;
  index: number;
}

/** Sorted nearest to (x, z) first. */
export function nodesOf(h: Harness, id: string, x: number, z: number): Found[] {
  const field = h.world.nodeField!;
  const kind = h.reg.index.get(id)!;
  const out: Found[] = [];
  const spot: NodeSpot = { kind: 0, form: 0, x: 0, y: 0, z: 0, yaw: 0 };
  for (let chunk = 0; chunk < h.world.dims.chunksX * h.world.dims.chunksZ; chunk++) {
    for (let index = 0; index < field.source.perChunk; index++) {
      field.source.at(chunk, index, spot);
      if (spot.kind === kind) out.push({ ...spot, chunk, index });
    }
  }
  return out.sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z));
}

/**
 * `s` must have cheats. Teleports it to dry open ground `distance` metres from the spot, facing it: a node's middle, half way
 * up its boxes. Returns false if there is nowhere to stand.
 */
export function standFacing(h: Harness, s: ClientSession, pilot: Pilot, at: { x: number; y: number; z: number; form?: number }, distance = 1.5): boolean {
  const p = h.reg.move[h.reg.index.get("core:survivor")!]!;
  for (let k = 0; k < 16; k++) {
    const a = (k * Math.PI) / 8;
    const x = at.x - Math.sin(a) * distance;
    const z = at.z - Math.cos(a) * distance;
    const y = h.world.hf.heightAt(x, z);
    if (y < h.world.hf.seaLevel + 0.2 || Math.abs(y - h.world.hf.heightAt(at.x, at.z)) > 0.8 || !capsuleFree(h.world, x, y, z, p.radius, p.height)) continue;
    // The server refuses a place inside a node of a chunk nobody holds, which the world here does not have.
    if (!h.say(s, `tp ${x.toFixed(3)} ${z.toFixed(3)}`).some((line) => line.startsWith("at "))) continue;
    pilot.yaw = a;
    const middle = at.form === undefined ? at.y : at.y + h.world.nodeField!.forms.halfY[at.form]! / 2;
    pilot.pitch = Math.atan2(middle - (y + 1.62), distance);
    h.run(200);
    return true;
  }
  return false;
}

/** Holds the primary button for exactly `n` swings. The first lands at once and the rest are `swingTicks` apart. */
export function swing(h: Harness, pilot: Pilot, n: number, swingTicks: number): void {
  pilot.buttons |= BTN_PRIMARY;
  h.run(((swingTicks * n - 5) * 1000) / 30);
  pilot.buttons &= ~BTN_PRIMARY;
  h.run(700);
}

/** Moves an item the survivor carries to a hotbar slot and selects it, as a player does. Returns the slot as an index into the whole inventory. */
export function takeInHand(h: Harness, s: ClientSession, item: number, hotbar = 0): number {
  const inv = s.inventory!;
  const to = inv.hotbar + hotbar;
  const from = inv.item.indexOf(item);
  if (from < 0) throw new Error("the survivor does not carry that");
  if (from !== to) {
    s.command(CMD_MOVE, (w) => {
      w.bits(BOX_SELF, 1);
      w.varint(from);
      w.bits(BOX_SELF, 1);
      w.varint(to);
      w.u16(0);
      w.u16(item);
    });
  }
  s.command(CMD_SELECT, (w) => w.u8(hotbar));
  h.run(200);
  return to;
}
