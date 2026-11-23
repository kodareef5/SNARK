import { expect, test } from "bun:test";
import { App } from "../../client/core/app.ts";
import { RemoteSample } from "../../client/core/session.ts";
import { BitReader } from "../../shared/net/codec.ts";
import { BUTTON_BITS, S_SNAPSHOT } from "../../shared/net/protocol.ts";
import { MODE_WALK } from "../../shared/sim/character.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { flatMap } from "../fixtures/map.ts";
import { Harness } from "../fixtures/net.ts";
import { corePack } from "../fixtures/pack.ts";

test("the owner's predicted walk adopts the server stride after dropped snapshots", () => {
  const pack = corePack(), h = new Harness({}, 15, 60, { wild: false, map: writeMap(flatMap(4)) });
  try {
    const s = h.join("walker", { latencyMs: 50 }, { manual: true });
    const app = new App(s, h.reg, pack), remote = new RemoteSample();
    h.run(900, now => { app.frame(now, 800, 600); });
    const c = h.client(s)!, e = c.ent, a = h.world.ents;
    const sent = new Map<number, { speed: number; stance: number; offset: number; grounded: boolean }>();
    const forward = c.conn.send.bind(c.conn);
    let dropped = 0, held = 0, matched = 0, mismatch = 0, airborne = 0, crouched = 0;
    c.conn.send = (channel, data) => {
      const r = new BitReader(data);
      if (r.u8() === S_SNAPSHOT) {
        const tick = r.u32(), age = r.u8();
        r.sbits(8); if (r.bool()) r.u16(); if (r.bool()) r.bits(BUTTON_BITS);
        r.bits(2); r.varint();
        const start = r.pos, changed = r.bool(), sample = changed ? r.bits(14) : 0;
        const view = c.views.find(tick)!, baseline = age ? c.views.find(tick - age)! : null;
        const anim = a.anim[e]!, speed = anim & 15, stance = (anim >>> 8) & 3;
        const offset = h.world.history.strideOf(e, tick, h.world), grounded = c.body.mode === MODE_WALK && c.body.grounded;
        const word = grounded ? 1 + ((stance * 16 + speed) * 256 + offset) : 0;
        expect(changed ? sample : (baseline?.ownStride ?? 0)).toBe(word);
        expect(view.ownStride).toBe(word);
        expect(r.pos - start).toBe(changed ? 15 : 1);
        if (changed && speed > 0 && dropped < 4) { dropped++; return; }
        if (speed > 0 && !changed) held++;
        sent.set(tick, { speed, stance, offset, grounded });
      }
      forward(channel, data);
    };
    const run = (ms: number) => h.run(ms, now => {
      app.frame(now, 800, 600);
      const st = app.scene?.own?.state, sample = sent.get(s.latestSnapshot);
      if (!st || !sample) return;
      s.sampleRemote(remote);
      expect(remote.id.subarray(0, remote.count).includes(e)).toBe(false);
      const matches = st.mode === MODE_WALK && st.grounded && sample.grounded && st.speed === sample.speed && st.stance === sample.stance;
      expect(st.stride).toBe(matches ? sample.offset : -1);
      if (matches && st.speed && st.stride > 0) { matched++; if (st.stance) crouched++; }
      if (!matches && st.grounded && sample.grounded) mismatch++;
      if (!st.grounded) airborne++;
    });
    app.key("KeyW", true); run(1600);
    app.key("Space", true); run(60); app.key("Space", false); run(1300);
    app.key("KeyC", true); run(60); app.key("KeyC", false); run(1400);
    expect(dropped).toBe(4);
    expect(held).toBeGreaterThan(15);
    expect(matched).toBeGreaterThan(40);
    expect(crouched).toBeGreaterThan(10);
    expect(mismatch).toBeGreaterThan(3);
    expect(airborne).toBeGreaterThan(3);
  } finally { h.host.shutdown(); }
});
