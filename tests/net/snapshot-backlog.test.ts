import { expect, test } from "bun:test";
import { TICK_RATE } from "../../shared/coords.ts";
import { BitReader } from "../../shared/net/codec.ts";
import { S_OWN, S_SNAPSHOT } from "../../shared/net/protocol.ts";
import { CH_RELIABLE, CH_UNRELIABLE } from "../../shared/net/transport.ts";
import { VIEW_RING } from "../../shared/net/view.ts";
import { Harness } from "../fixtures/net.ts";

test("a backed-up socket skips snapshot work and resumes from a usable baseline", () => {
  const h = new Harness({ snapshotEvery: 1 });
  const slow = h.join("slow"), fast = h.join("fast");
  h.run(1000);
  const client = h.client(slow)!;
  const end = h.ends[0]!;
  const server = end.peer;
  const limit = 2 * h.server.opts.snapshotBytesMax;
  let queued = 0, refused = 0, built = 0, sent = 0, own = 0;
  const gate = server.gate!;
  server.gate = (channel) => {
    const ok = gate(channel, queued);
    if (!ok && channel === CH_UNRELIABLE) refused++;
    return ok;
  };
  const rep = h.server.replication;
  const viewFor = rep.viewFor!;
  rep.viewFor = (c, view) => {
    if (c === client) built++;
    return viewFor(c, view);
  };
  const ages: number[] = [];
  const header = new BitReader();
  const receive = end.onMessage!;
  end.onMessage = (channel, data) => {
    if (channel === CH_RELIABLE && data[0] === S_OWN) own++;
    if (data[0] === S_SNAPSHOT) {
      header.reset(data);
      header.u8();
      header.u32();
      ages.push(header.u8());
    }
    receive(channel, data);
  };
  const onSnapshot = rep.onSnapshot!;
  rep.onSnapshot = (c, view) => {
    if (c === client) sent++;
    onSnapshot(c, view);
  };
  for (const ticks of [8, VIEW_RING + 4]) {
    const before = client.lastSnapshot;
    queued = limit + 1;
    client.ownDirty = true;
    h.run(ticks * 1000 / TICK_RATE);
    expect(refused).toBe(h.world.tick - before);
    expect(built).toBe(0);
    expect(sent).toBe(0);
    expect(own).toBeGreaterThan(0);
    expect(client.lastSnapshot).toBe(before);
    expect(fast.latestSnapshot).toBeGreaterThan(before);

    ages.length = 0;
    queued = limit;
    h.run(300);
    expect(ages.length).toBeGreaterThan(0);
    if (ticks < VIEW_RING) expect(ages[0]).toBeGreaterThan(0);
    else expect(ages[0]).toBe(0);
    expect(slow.latestSnapshot).toBeGreaterThan(before);
    expect(slow.stats.undecodable).toBe(0);
    refused = built = sent = own = 0;
  }
  h.host.shutdown();
});
