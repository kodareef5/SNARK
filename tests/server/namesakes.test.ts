// Two survivors whose names differ only by capitals or spacing are two survivors. One of them must not be able to speak for,
// be muted as, be invited as or be put out as the other.

import { expect, test } from "bun:test";
import type { ClientSession } from "../../client/core/session.ts";
import { RESULT_BUSY, RESULT_OK, TEXT_GLOBAL } from "../../shared/net/protocol.ts";
import { flatGround } from "../fixtures/arena.ts";
import { Harness } from "../fixtures/net.ts";

/** Text on one channel since log version `from`. */
const heard = (s: ClientSession, from: number): string[] =>
  s.log
    .slice(Math.max(0, s.log.length - (s.logVersion - from)))
    .filter((l) => l.channel === TEXT_GLOBAL)
    .map((l) => l.text);

test("a namesake in other capitals cannot use up a survivor's say, get her muted, change whom she hears, or be invited or put out in her place", () => {
  const h = new Harness({}, 1, 60, { dev: true });
  // The impersonator arrives first, so wherever the first match is taken, it is hers.
  const [fake, ada, bob] = ["ADA", "Ada", "bob"].map((n) => h.join(n)) as [ClientSession, ClientSession, ClientSession];
  h.run(600);
  const g = flatGround(h, 16, 16);
  [fake, ada, bob].forEach((s, i) => {
    h.say(s, "enablecheats");
    h.say(s, `tp ${(g.x + 6 + i * 1.5).toFixed(3)} ${(g.z + 8).toFixed(3)}`);
  });
  const rec = (s: ClientSession) => h.host.records.byPid.get(h.client(s)!.pid)!;
  const say = (s: ClientSession, words: string): number => {
    let code = -1;
    s.onResult = (_seq, result) => void (code = result);
    s.chat(TEXT_GLOBAL, words);
    h.run(100);
    return code;
  };

  // The namesake says all she may at once. Ada has still said nothing, and may.
  const codes = [0, 1, 2, 3, 4, 5].map((i) => say(fake, `noise ${i}`));
  expect(codes).toEqual([RESULT_OK, RESULT_OK, RESULT_OK, RESULT_OK, RESULT_OK, RESULT_BUSY]);
  let from = bob.logVersion;
  expect(say(ada, "hello")).toBe(RESULT_OK);
  expect(heard(bob, from)).toEqual(["Ada: hello"]);

  // Bob mutes the noisy one by her name. He still hears Ada. Ada may mute her too: she is not Ada.
  expect(h.say(bob, "mute ADA")[0]).toBe("You will not hear ADA.");
  expect(h.say(ada, "mute ADA")[0]).toBe("You will not hear ADA.");
  expect(h.say(ada, "mute Ada")[0]).toBe("That is you.");
  h.run(12000);
  from = bob.logVersion;
  expect([say(fake, "more noise"), say(ada, "hello again")]).toEqual([RESULT_OK, RESULT_OK]);
  expect(heard(bob, from)).toEqual(["Ada: hello again"]);
  // Whom the namesake mutes is her own business: Ada hears Bob as before.
  expect(h.say(fake, "mute bob")[0]).toBe("You will not hear bob.");
  from = ada.logVersion;
  expect(say(bob, "anyone there")).toBe(RESULT_OK);
  expect([heard(ada, from), h.say(ada, "mute")[0], h.say(fake, "mute")[0]]).toEqual([["bob: anyone there"], "Muted: ADA", "Muted: bob"]);
  // A name with other spacing is another name too, and a name written loosely means the only one it could.
  expect([h.host.chat.muted("bob", "ADA"), h.host.chat.muted("bob", "ADA "), h.host.chat.muted("bob", "Ada")]).toEqual([true, false, false]);
  expect(h.say(bob, "unmute ada")[0]).toBe("You will hear ada again.");
  expect(h.say(bob, "mute")[0]).toBe("You have muted nobody.");

  // Bob founds a tribe. A name that fits both invites neither, and each exact name invites its own.
  h.say(bob, "tribe create Wolves");
  expect(h.say(bob, "tribe invite ada")[0]).toBe('more than one survivor here could be "ada"; give the name exactly');
  expect(h.say(bob, "tribe invite Ada")[0]).toBe("You invited Ada.");
  expect([ada.tribe.invite, fake.tribe.invite]).toEqual(["Wolves", ""]);
  h.say(ada, "tribe accept");
  expect(h.say(bob, "tribe invite ADA")[0]).toBe("You invited ADA.");
  h.say(fake, "tribe accept");
  expect([rec(ada).team, rec(fake).team]).toEqual([rec(bob).team, rec(bob).team]);
  // Putting one out takes her exact name while both are members.
  expect(h.say(bob, "tribe kick ada")[0]).toBe("more than one member of Wolves could be ada; give the name exactly");
  expect(h.say(bob, "tribe kick ADA")[0]).toBe("ADA is out of the tribe.");
  expect([rec(ada).team === rec(bob).team, rec(fake).team === rec(bob).team]).toEqual([true, false]);
  // With one left, any capitals mean her.
  expect(h.say(bob, "tribe kick ADA")[0]).toBe("ADA is out of the tribe.");
  expect(rec(ada).team).not.toBe(rec(bob).team);
});
