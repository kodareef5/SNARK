import { expect, test } from "bun:test";
import { Allowance, Guesses, countedAs } from "../../server/guesses.ts";
import { TICK_RATE } from "../../shared/coords.ts";

const HOUR = 3600 * TICK_RATE;

test("an IPv4 address is counted as itself, an IPv6 one by its machine's 64 bits and its site's 48, and a name as itself", () => {
  expect(countedAs("203.0.113.7")).toEqual(["203.0.113.7"]);
  expect(countedAs("::ffff:203.0.113.7")).toEqual(["203.0.113.7"]);
  expect(countedAs("2001:db8:1:2::a")).toEqual(["2001:db8:1:2::/64", "2001:db8:1::/48"]);
  expect(countedAs("2001:0DB8:0001:0002:ffff:1:2:3")).toEqual(["2001:db8:1:2::/64", "2001:db8:1::/48"]);
  expect(countedAs("2001:db8::7")).toEqual(["2001:db8:0:0::/64", "2001:db8:0::/48"]);
  expect(countedAs("fe80::1%en0")).toEqual(["fe80:0:0:0::/64", "fe80:0:0::/48"]);
  expect([countedAs("ada"), countedAs("12")]).toEqual([["ada"], ["12"]]);
});

test("a machine that takes another address of its IPv6 network waits as one, and so does a site past four machines' guesses", () => {
  const g = new Guesses();
  for (const a of ["2001:db8:1:2::a", "2001:db8:1:2::b", "2001:db8:1:2::c"]) g.wrong(a, 0);
  expect([g.wait("2001:db8:1:2::d", 1), g.wait("2001:db8:1:3::a", 1), g.wait("203.0.113.7", 1)]).toEqual([30 * TICK_RATE - 1, 0, 0]);
  // The right password forgives the machine, not its site, which another may share.
  g.right("2001:db8:1:2::d");
  expect(g.wait("2001:db8:1:2::d", 1)).toBe(0);
  for (let m = 3; m < 12; m++) g.wrong(`2001:db8:1:${m.toString(16)}::1`, 0);
  expect([g.wait("2001:db8:1:ff::1", 1), g.wait("2001:db8:2:ff::1", 1)]).toEqual([30 * TICK_RATE - 1, 0]);
});

test("a wait outlives a flood of new keys; a table full of running waits judges no new key until one has run out; a day forgets", () => {
  const g = new Guesses();
  for (let i = 0; i < 3; i++) g.wrong("203.0.113.7", 0);
  for (let i = 0; i < 70_000; i++) g.wrong(`10.${i >> 16}.${(i >> 8) & 255}.${i & 255}`, 1);
  expect(g.wait("203.0.113.7", 2)).toBeGreaterThan(0);
  const full = new Guesses();
  for (let i = 0; i < 65_536; i++) for (let k = 0; k < 3; k++) full.wrong(`10.${i >> 16}.${(i >> 8) & 255}.${i & 255}`, 0);
  expect(full.wait("203.0.113.8", 1)).toBeGreaterThan(0);
  expect(full.wait("203.0.113.8", 31 * TICK_RATE)).toBe(0);
  full.wrong("203.0.113.8", 31 * TICK_RATE);
  for (let k = 0; k < 2; k++) full.wrong("203.0.113.8", 31 * TICK_RATE);
  expect(full.wait("203.0.113.8", 32 * TICK_RATE)).toBeGreaterThan(0);
  expect(full.wait("203.0.113.8", 31 * TICK_RATE + 24 * HOUR)).toBe(0);
});

test("new survivors are allowed eight a machine and thirty-two a site an hour, a flood of others forgets none, and a full table allows none", () => {
  const a = new Allowance(8, HOUR);
  for (let i = 0; i < 8; i++) expect(a.take(`2001:db8:1:2::${i + 1}`, 0)).toBe(true);
  expect([a.take("2001:db8:1:2::99", 1), a.take("2001:db8:1:3::1", 1)]).toEqual([false, true]);
  for (let m = 4; m < 26; m++) a.take(`2001:db8:1:${m.toString(16)}::1`, 2);
  expect([a.take("2001:db8:1:ff::1", 3), a.take("2001:db8:1:fe::1", 3), a.take("2001:db8:2:ff::1", 3)]).toEqual([true, false, true]);
  for (let i = 0; i < 70_000; i++) a.take(`10.${i >> 16}.${(i >> 8) & 255}.${i & 255}`, 4);
  expect(a.take("2001:db8:1:2::1", 5)).toBe(false);
  expect(a.take("203.0.113.7", 5)).toBe(false);
  expect([a.take("2001:db8:1:2::1", HOUR), a.take("203.0.113.7", HOUR + 4)]).toEqual([true, true]);
});
