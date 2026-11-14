// Who gets in, who is turned away, and what a connection costs before it has said who it is.

import { expect, test } from "bun:test";
import { REJECT_DENIED, REJECT_NAME, SESSION_DEAD } from "../../shared/net/protocol.ts";
import { Harness, testKey } from "../fixtures/net.ts";

test("a survivor back on a new connection takes its body over, though the old connection never closed", () => {
  const h = new Harness();
  const ada = h.join("ada");
  h.pilots[0]!.moveZ = 1;
  h.run(1000);
  h.pilots[0]!.moveZ = 0;
  h.run(300);
  const handle = ada.ownHandle;
  const z = h.world.ents.z[h.ent(ada)]!;
  // Its device lost the network and the page was loaded again. Nothing has closed the old socket.
  const again = h.join("ada");
  h.run(500);
  expect([again.state, again.ownHandle, again.own.z, h.server.playerCount, h.world.ents.count]).toEqual(["active", handle, z, 1, 1]);
  expect([ada.state, ada.closeReason]).toEqual(["closed", REJECT_NAME]);
  h.pilots[1]!.moveZ = 1;
  h.run(500);
  expect(h.world.ents.z[h.ent(again)]!).toBeGreaterThan(z + 1);

  // Another device is refused as before, and the body stays with the one that has it.
  const thief = h.join("ada", {}, { key: testKey("thief") });
  h.run(300);
  expect([thief.state, thief.closeReason, again.state]).toEqual(["closed", REJECT_DENIED, "active"]);

  // A session with no body has nothing to take over: the old one ends and the new one joins as it would have.
  h.say(again, "suicide");
  const third = h.join("ada");
  h.run(500);
  expect([again.state, third.state, third.sessionState, h.server.playerCount]).toEqual(["closed", "active", SESSION_DEAD, 1]);
});
