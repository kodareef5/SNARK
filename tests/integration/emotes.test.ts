// Survivors' emotes on a server in process (server/emote.ts): played, seen by another client, ended by moving; a pair
// begun only when both ask, the two stood face to face and begun on one tick; a dance joined in step.

import { expect, test } from "bun:test";
import { EMOTE_NUMBER, emoteOf } from "../../shared/anim/emotes.ts";
import { AnimState, EMOTE_LEAD, EMOTE_PARTNER } from "../../shared/anim/pose.ts";
import { TAU } from "../../shared/math/scalar.ts";
import { EMOTE_JOIN, EMOTE_PLAY } from "../../server/emote.ts";
import { RemoteSample } from "../../client/core/session.ts";
import { Harness } from "../fixtures/net.ts";

const num = (id: string) => EMOTE_NUMBER.get(id)!;

/** Two survivors standing `apart` metres from each other on open ground. */
function two(apart = 2) {
  const h = new Harness({}, 1, 60, { dev: true });
  const a = h.join("Ana");
  const b = h.join("Bo");
  h.run(800);
  h.say(a, "enablecheats");
  const ea = h.ent(a), eb = h.ent(b);
  const [x, z] = [h.world.ents.x[ea]!, h.world.ents.z[ea]!];
  h.say(a, `tp ${x.toFixed(3)} ${z.toFixed(3)}`);
  h.say(b, "enablecheats");
  h.say(b, `tp ${(x + apart).toFixed(3)} ${z.toFixed(3)}`);
  h.run(500);
  return { h, a, b, ea, eb };
}

/** The emote as entity `e`'s word unpacks it. */
const emoteOfEnt = (h: Harness, e: number) => {
  const st = new AnimState();
  st.unpackEmote(h.world.ents.emote[e]!);
  return st;
};

test("an emote plays, reaches another client in the view, and a whole-body one ends when the body moves", () => {
  const { h, a, b, ea } = two();
  a.emote(EMOTE_PLAY, num("robot"));
  h.run(300);
  expect(emoteOfEnt(h, ea).emote).toBe(num("robot"));
  // The other client draws Ana dancing: her emote word is in what Bo's view samples.
  const r = new RemoteSample();
  b.sampleRemote(r);
  const row = [...Array(r.count).keys()].find((i) => r.id[i] === ea);
  expect(row).toBeDefined();
  expect(r.emote[row!]).toBe(h.world.ents.emote[ea]);
  // Moving ends it.
  h.pilots[0]!.moveZ = 1;
  h.run(600);
  h.pilots[0]!.moveZ = 0;
  expect(h.world.ents.emote[ea]).toBe(0);
});

test("a one-shot ends by itself; an upper-body one plays while walking", () => {
  const { h, a, ea } = two();
  a.emote(EMOTE_PLAY, num("wave"));
  h.pilots[0]!.moveZ = 1;
  h.run(400);
  expect(emoteOfEnt(h, ea).emote).toBe(num("wave"));
  h.pilots[0]!.moveZ = 0;
  h.run(3000);
  expect(h.world.ents.emote[ea]).toBe(0);
});

test("a pair begins only when both ask: then face to face, apart as the move wants, on one tick", () => {
  const { h, a, b, ea, eb } = two(2.2);
  const n = num("high_five");
  // Ana asks; Bo is told, and nothing plays yet.
  const before = b.logVersion;
  a.emote(EMOTE_PLAY, n, eb);
  h.run(300);
  expect(h.world.ents.emote[ea]).toBe(0);
  expect(b.log.slice(-(b.logVersion - before)).map((l) => l.text).join(" ")).toContain("would like a high five");
  // Bo answers at Ana.
  b.emote(EMOTE_PLAY, n, ea);
  h.run(200);
  const sa = emoteOfEnt(h, ea), sb = emoteOfEnt(h, eb);
  expect(sa.emote).toBe(n);
  expect(sb.emote).toBe(n);
  expect(sa.emoteStart).toBe(sb.emoteStart);
  expect(sa.emoteRole).toBe(EMOTE_LEAD);
  expect(sb.emoteRole).toBe(EMOTE_PARTNER);
  const ents = h.world.ents;
  const dx = ents.x[eb]! - ents.x[ea]!, dz = ents.z[eb]! - ents.z[ea]!;
  expect(Math.hypot(dx, dz)).toBeCloseTo(emoteOf(n)!.pair!.apart, 1);
  // Each faces the other: +Z is (sin yaw, cos yaw).
  const facing = (e: number) => (ents.yaw[e]! / 65536) * TAU;
  const ya = facing(ea), yb = facing(eb);
  expect(Math.sin(ya) * dx + Math.cos(ya) * dz).toBeGreaterThan(0.6);
  expect(-(Math.sin(yb) * dx + Math.cos(yb) * dz)).toBeGreaterThan(0.6);
  // It plays out and ends for both.
  h.run(3000);
  expect(ents.emote[ea]).toBe(0);
  expect(ents.emote[eb]).toBe(0);
});

test("an invite left unanswered lapses, and a body too far is not asked", () => {
  const { h, a, b, ea, eb } = two(2);
  const n = num("handshake");
  a.emote(EMOTE_PLAY, n, eb);
  h.run(9000);
  b.emote(EMOTE_PLAY, n, ea);
  h.run(300);
  // Bo's answer came too late: it is an invite of its own, and nothing plays.
  expect(h.world.ents.emote[ea]).toBe(0);
  expect(h.world.ents.emote[eb]).toBe(0);
  expect(h.host.emotes.inviteOf(ea)?.from).toBe(eb);
  const far = two(8);
  expect(far.h.host.emotes.request(far.ea, EMOTE_PLAY, n, far.eb)).not.toBe(0);
});

test("joining a dance plays it from the same first tick, in step", () => {
  const { h, a, b, ea, eb } = two(3);
  a.emote(EMOTE_PLAY, num("disco"));
  h.run(1500);
  b.emote(EMOTE_JOIN, 0, ea);
  h.run(300);
  const sa = emoteOfEnt(h, ea), sb = emoteOfEnt(h, eb);
  expect(sb.emote).toBe(num("disco"));
  expect(sb.emoteStart).toBe(sa.emoteStart);
});

test("the console plays emotes by name and lists them by tag", () => {
  const { h, a, ea } = two();
  expect(h.say(a, "emotes dance").join("\n")).toContain("robot");
  h.say(a, "emote cheer");
  expect(emoteOfEnt(h, ea).emote).toBe(num("cheer"));
  expect(h.say(a, "emote moonwalk").join(" ")).toContain('no emote "moonwalk"');
});
