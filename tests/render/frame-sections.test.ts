import { expect, test } from "bun:test";
import { FRAME, FRAME_BLOCK, FRAME_FLOATS, FRAME_SECTIONS, LAMP_AT, OPTIC_AT, ROOF_AT, WATER_MARKS, sectionStarts } from "../../client/core/render/packet.ts";

/** Where each member of the block's GLSL begins, in floats, as std140 lays out vec4s and mat4s, and where the block ends. */
function members(): Map<string, number> {
  const at = new Map<string, number>();
  let next = 0;
  const body = FRAME_BLOCK.slice(FRAME_BLOCK.indexOf("{") + 1, FRAME_BLOCK.indexOf("}"));
  for (const line of body.matchAll(/highp (vec4|mat4) ([^;]+);/g)) {
    for (const member of line[2]!.split(",")) {
      const [, name, count] = /(\w+)(?:\[(\d+)\])?/.exec(member.trim())!;
      at.set(name!, next);
      next += (line[1] === "mat4" ? 16 : 4) * Number(count ?? 1);
    }
  }
  return at.set("end", next);
}

test("each section of the frame block begins where the GLSL puts its first member", () => {
  const glsl = members(), starts: Record<string, number> = sectionStarts(FRAME_SECTIONS);
  for (const s of FRAME_SECTIONS) expect(`${s.name} at ${starts[s.name]}`).toBe(`${s.name} at ${glsl.get(s.first)}`);
  expect(FRAME_FLOATS).toBe(glsl.get("end")!);
});

test("a section begins where the one before it ends, and the offsets code reads are those", () => {
  const starts: Record<string, number> = sectionStarts(FRAME_SECTIONS);
  let next = 0;
  for (const s of FRAME_SECTIONS) {
    expect(starts[s.name]).toBe(next);
    next += s.floats;
  }
  expect(starts.end).toBe(next);
  expect([FRAME.contact, FRAME.eyes, FRAME.exhaustPhase, WATER_MARKS, ROOF_AT, LAMP_AT, OPTIC_AT]).toEqual([starts.contact!, starts.eyes!, starts.effects!, starts.waterMarks!, starts.roof!, starts.lamp!, starts.optic!]);
});

test("a section listed twice, or not of whole vec4s, is refused", () => {
  expect(() => sectionStarts([{ name: "a", first: "fA", floats: 4 }, { name: "a", first: "fB", floats: 4 }])).toThrow("listed twice");
  expect(() => sectionStarts([{ name: "a", first: "fA", floats: 6 }])).toThrow("whole vec4s");
});
