import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CUTS, adsIn, sheetOf } from "../../tools/screens/ads/facts.ts";

const DIR = join(import.meta.dir, "../../tools/screens/ads");
const ads = adsIn(DIR);

describe("sample ads", () => {
  test("every page names itself and fits its type's limits", () => {
    expect(ads.length).toBeGreaterThan(0);
    expect(new Set(ads.map((a) => a.facts.name)).size).toBe(ads.length);
  });

  test("every billboard, TV and laptop has some", () => {
    for (const type of ["billboard", "tv", "laptop"]) expect(ads.some((a) => a.facts.type === type)).toBe(true);
  });

  test("a moving page draws by frame(t), never by the clock", () => {
    for (const { file, facts } of ads) {
      const text = readFileSync(file, "utf8");
      if (facts.kind === "clip") expect(text).toContain("function frame(t)");
      expect(text).not.toMatch(/Date\.now|performance\.now|setInterval|@keyframes|requestAnimationFrame/);
    }
  });

  test("every picture a page uses is a cutout creatures.ts makes", () => {
    for (const { file } of ads) {
      for (const [, src] of readFileSync(file, "utf8").matchAll(/data-(?:src|frames)="([^"]+)"/g)) {
        const m = src!.match(/^art\/(.+?)(-%02d|-\d\d)?\.png$/);
        const cut = CUTS.find((c) => c.name === m?.[1]);
        expect(cut).toBeDefined();
        expect(cut!.frame === "all").toBe(m![2] !== undefined);
      }
    }
  });

  test("the sheet gives each file one row, and a flashing one no channel", () => {
    const rows = sheetOf([
      { name: "a", title: "A, said twice", type: "billboard", kind: "image" },
      { name: "b", title: "B", type: "tv", kind: "clip", seconds: 12, poster: 3, flashes: true },
    ]).trim().split("\n");
    expect(rows[0]).toBe("file,name,title,kind,types,channels,rights,licence,by,year,poster,audio,flashes");
    expect(rows[1]).toBe('a.png,a,"A, said twice",image,billboard,Billboard ads,"Made for SNARK, 2026",Made for the game and given to it under CC0 1.0.,SNARK,2026,,,no');
    expect(rows[2]).toBe('b.mp4,b,B,clip,tv,,"Made for SNARK, 2026",Made for the game and given to it under CC0 1.0.,SNARK,2026,3,no,yes');
  });
});
