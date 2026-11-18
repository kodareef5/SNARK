import lines from "./yacht-lines.json" with { type: "json" };
import type { MarineModel, MarinePoint } from "./marine-model.ts";

type Lines = typeof lines.solstice;
const point = (v: readonly number[]): MarinePoint => [v[0]!, v[1]!, v[2]!];
const box = (x: number, lo: number, hi: number, aft: number, fore: number, width: number) => ({
  at: [x, (lo + hi) / 2, (fore + aft) / 2] as const,
  half: [width / 2, (hi - lo) / 2, (fore - aft) / 2] as const,
});

function yacht(name: keyof typeof lines, d: Lines): MarineModel {
  const end = d.length / 2;
  const seats = d.seats.map(point);
  const [x, y, z] = seats[0]!;
  const wing = d.beam / 2 - 0.24;
  const cabin = name === "solstice" ? [] : [
    box(wing * 0.86, d.main, d.main + 1.86, -end * 0.32, end * 0.21, 0.13),
    box(-wing * 0.86, d.main, d.main + 1.86, -end * 0.32, end * 0.21, 0.13),
  ];
  const risers = Math.ceil((d.main - d.terrace) / .20);
  const steps = Array.from({ length: risers }, (_, i) => {
    const tread = (d.stepTop - d.stepBottom) / risers;
    const top = d.terrace + (d.main - d.terrace) * (i + 1) / risers;
    return box(0, d.draft * .24, top, d.stepBottom + tread * i, d.stepBottom + tread * (i + 1), d.beam * .87);
  });
  const deck = name === "belvedere" ? 5.02 : name === "sovereign" ? 5.64 : 0;
  if (deck) cabin.push(box(0, deck - .24, deck, -end * .53, end * .30, d.beam * .70));
  if (name === "sovereign") cabin.push(box(0, 7.81, 8.02, -end * .38, end * .25, d.beam * .61));
  return {
    id: `core:${name}`, label: name[0]!.toUpperCase() + name.slice(1), family: "yacht",
    length: d.length, beam: d.beam, height: d.height, draft: d.draft, beltline: d.main + .28,
    seats, helm: [x, y + .36, z + .30], grip: .18, camera: [x, y + .76, z + .05],
    propeller: [d.portShaft, d.propY, d.propZ], secondPropeller: [-d.portShaft, d.propY, d.propZ],
    boarding: { water: [d.ladderX, d.draft, -end - .72], ladder: [d.ladderX, d.terrace, -end + .04], deck: [d.ladderX, d.terrace, -end + .67] },
    boxes: [
      box(0, d.draft * .51, d.terrace, -end, d.stepBottom, d.beam * .72),
      ...steps,
      box(0, .01, d.main, d.stepTop, end * .19, d.beam * .98),
      box(0, d.draft * .24, d.main + d.sheer * .22, end * .19, end * .52, d.beam * .85),
      box(0, d.draft * .54, d.main + d.sheer * .55, end * .52, end * .79, d.beam * .59),
      box(0, d.draft * .94, d.main + d.sheer, end * .79, end, d.beam * .24),
      ...cabin,
    ],
    paint: d.paint,
  };
}

export const MOTOR_YACHTS = (Object.keys(lines) as (keyof typeof lines)[]).map(name => yacht(name, lines[name]));
