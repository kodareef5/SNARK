import { expect, test } from "bun:test";
import { titleReleases } from "../../tools/build-entry.ts";

test("the title keeps every version, feature group and bullet in archive order", () => {
  const archive = "v0.0.9 — 2026-11-24\r\n\r\nWater\r\n- Bow spray.\r\n- Shore foam.\r\n\r\nVehicles\r\n- Fixed parking brakes.\r\n\r\nv0.0.8 — 2026-11-20\r\n\r\nTitle\r\n- Live scene.\r\n";
  expect(titleReleases(archive, "0.0.9")).toEqual([
    { version: "v0.0.9", date: "2026-11-24", groups: [{ feature: "Water", bullets: ["Bow spray.", "Shore foam."] }, { feature: "Vehicles", bullets: ["Fixed parking brakes."] }] },
    { version: "v0.0.8", date: "2026-11-20", groups: [{ feature: "Title", bullets: ["Live scene."] }] },
  ]);
  expect(() => titleReleases(archive, "0.0.8")).toThrow();
  expect(() => titleReleases(archive.replace("- Live scene.", "Live scene."), "0.0.9")).toThrow();
});
