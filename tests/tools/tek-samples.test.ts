import { expect, test } from "bun:test";
import { STRUCT_UNITS } from "../../shared/coords.ts";
import { BOX_OPEN, BOX_SELF, CMD_MOVE, CMD_STRUCT } from "../../shared/net/protocol.ts";
import { frame, frameOf } from "../../shared/world/frame.ts";
import { floorTop, units } from "../../shared/world/snap.ts";
import { NO_PIN, STRUCT_USE } from "../../shared/world/upkeep.ts";
import { stageOutpost } from "../../tools/pieces/tek-preview.ts";
import { stageTekSamples } from "../../tools/pieces/tek-samples.ts";
import { Harness } from "../fixtures/net.ts";

test("the lab Fabricator rests in its rear bay and supplies every Tek building item", () => {
  const h = new Harness({}, 1, 60, { dev: true });
  try {
    const owner = h.join("builder"), visitor = h.join("reviewer");
    h.run(350);
    const crew = h.host.records.byPid.get(h.client(owner)!.pid)!;
    const reviewer = h.host.records.byPid.get(h.client(visitor)!.pid)!;
    expect(h.host.tribes.create(crew, "Outpost crew")).toBe("");
    expect(h.host.tribes.invite(crew, reviewer, true)).toBe("");
    expect(h.host.tribes.accept(reviewer)).toBe("");
    const { structs } = h.world, reg = h.reg;
    const refs = stageOutpost(h.world, crew.team), first = refs[0]!;
    const ref = stageTekSamples(h.host, first, crew.team);
    const floor = structs.chunks[first >>> 16]!, s = first & 65535;
    const table = structs.chunks[ref >>> 16]!, i = ref & 65535, fabricator = reg.index.get("core:fabricator")!;
    const x = table.x[i]!, y = table.y[i]!, z = table.z[i]!;
    frameOf(floor.yaw[s]!, floor.twAt(s));
    const c = frame.cos, n = frame.sin;
    const dx = x - floor.x[s]!, dz = z - floor.z[s]!;
    expect(dx * c - dz * n).toBeCloseTo(0, 2);
    expect(dx * n + dz * c).toBeCloseTo(3.72, 2);
    expect([table.kind[i], table.owner[i], table.hp[i], table.yaw[i]]).toEqual([fabricator, crew.team, reg.maxHp[fabricator], floor.yaw[s]]);
    const foot = y - reg.halfY[fabricator]!;
    expect(refs.some(r => Math.abs(floorTop(structs, reg, r, units(x), units(z)) / STRUCT_UNITS - foot) < .002)).toBe(true);
    h.world.ents.setPosition(h.ent(visitor), x - n * 1.35, foot + .02, z - c * 1.35);
    h.run(200);
    visitor.command(CMD_STRUCT, w => { w.u32(ref); w.u8(STRUCT_USE); w.u16(NO_PIN); });
    h.run(350);
    const stock = visitor.open!.inventory;
    expect(stock.cap).toBe(reg.structSlots[fabricator]!);
    const pieces = ["ceiling", "door", "double_door", "double_doorway", "fence_foundation", "foundation", "gate", "gateway", "half_wall", "ladder", "large_wall",
      "pillar", "railing", "roof", "sloped_wall", "stairs", "trapdoor", "trapdoor_frame", "triangle_ceiling", "triangle_foundation", "triangle_roof", "wall"];
    const expected = pieces.map(name => reg.index.get(`core:piece_${name}_tek`)!);
    expect([...stock.item].filter(item => item > 0).sort((a, b) => a - b)).toEqual(expected.toSorted((a, b) => a - b));
    for (const item of expected) expect(stock.total(item)).toBe(4);
    const roof = reg.index.get("core:piece_triangle_roof_tek")!, bag = visitor.inventory!;
    visitor.command(CMD_MOVE, w => {
      w.bits(BOX_OPEN, 1); w.varint(stock.item.indexOf(roof)); w.bits(BOX_SELF, 1);
      w.varint(bag.item.indexOf(0)); w.u16(1); w.u16(roof);
    });
    h.run(300);
    expect([bag.total(roof), stock.total(roof)]).toEqual([1, 3]);
    expect(stageTekSamples(h.host, first, crew.team)).toBe(ref);
    expect(h.host.items.inv(h.host.fixtures.find(ref)!).total(roof)).toBe(3);
    expect(h.host.items.audit()).toEqual([]);
  } finally {
    h.host.shutdown();
  }
});
