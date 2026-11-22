// A sight that magnifies far brings what it is on near (D1087): the server sends its cone's chunks whole, so the page draws
// them as it draws those round the body, and lets them go a while after the sight is lowered.

import { expect, test } from "bun:test";
import type { ClientSession } from "../../client/core/session.ts";
import { CHUNK_SIZE, chunkAt } from "../../shared/coords.ts";
import { CMD_GAZE } from "../../shared/net/protocol.ts";
import { BTN_SECONDARY, stanceEye } from "../../shared/sim/character.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { CONE_KEEP } from "../../server/game.ts";
import { building } from "../fixtures/cityworld.ts";
import { takeInHand } from "../fixtures/gather.ts";
import { flatMap } from "../fixtures/map.ts";
import { Harness } from "../fixtures/net.ts";

const MID = 24 * CHUNK_SIZE;
const OFF = 1300;

test("through a spyglass a tower 1.3 km off comes whole to the page, as if it stood near; lowered, it goes a while after", () => {
  const tower = building(MID + 16, MID + OFF + 16, 0, 6);
  const h = new Harness({}, 9, 30, { dev: true, map: writeMap(flatMap(48, { statics: tower })) });
  const s = h.join("ada");
  h.run(1000);
  s.text("enablecheats");
  h.run(300);
  s.text(`tp ${MID} ${MID}`);
  h.run(1500);
  const rec = h.host.records.byPid.get(h.client(s)!.pid)!;
  h.host.items.mint(rec, h.reg.index.get("core:spyglass")!, 1);
  h.run(300);
  takeInHand(h, s, h.reg.index.get("core:spyglass")!);
  h.run(500);
  const chunk = chunkAt(h.world.dims, MID + 16, MID + OFF + 16);
  const held = (who: ClientSession): boolean => who.world!.structs.held.includes(chunk);
  expect(held(s)).toBe(false);
  const p = h.pilots[0]!;
  p.yaw = 0;
  p.pitch = -Math.atan2(stanceEye(h.reg.move[h.reg.index.get("core:survivor")!]!, 0), OFF);
  p.buttons |= BTN_SECONDARY;
  for (let t = 0; t < 4; t++) {
    s.command(CMD_GAZE, (w) => (w.u16(16 * 16), w.u16(0), w.u16(0)));
    h.run(1000);
  }
  expect(h.host.gaze.count).toBe(1);
  // Whole on the page, its pieces as the map has them, and the server's count of what it was sent.
  expect(held(s)).toBe(true);
  expect(s.world!.structs.chunks[chunk]!.high).toBe(h.world.structs.chunks[chunk]!.high);
  // Lowered: the cone empties at once, and the chunk is let go once its keep is past.
  p.buttons &= ~BTN_SECONDARY;
  s.command(CMD_GAZE, (w) => (w.u16(0), w.u16(0), w.u16(0)));
  h.run(1000);
  expect(held(s)).toBe(true);
  h.run(((CONE_KEEP + 32) * 1000) / 30);
  expect(held(s)).toBe(false);
});
