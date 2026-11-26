// Populations: who a crowd is made of. The person generator (shared/people/person.ts) draws each person of one from a
// seed, part by part, by the weights and ranges here.

import { BEARD_STYLES, BROW_STYLES, COMPLEXIONS, HAIR_STYLES, REGIONS } from "../../anim/look.ts";
import { EYE_COLORS, HAIR_COLORS, SKIN_TONES } from "../../pack/palette.ts";
import { f, row, type Fields, type Kind, type Named } from "../kind.ts";

/** A low and a high, each from -1 to 1 unless said. */
export type Span = readonly [number, number];

/** Each body region's key in `regions`: its label in lower case, words joined by "_" ("Head size" is head_size). */
export const REGION_KEYS: readonly string[] = REGIONS.map((r) => r.label.toLowerCase().replace(/ /g, "_"));

/** Who a crowd is made of. A list of weights has one for each choice in the look's order; a missing weight is 0. */
export interface PopulationDef extends Named {
  readonly type: "population";
  readonly id: string;
  readonly label: string;
  /** The share of women, 0 to 1. */
  readonly women: number;
  /** Weights for each skin tone, eye colour and complexion. */
  readonly skin: readonly number[];
  readonly eyes: readonly number[];
  readonly complexions?: readonly number[];
  /** Weights for each hair style, for men and for women. */
  readonly hair: { readonly men: readonly number[]; readonly women: readonly number[] };
  readonly hairColors: readonly number[];
  /** The chance, 0 to 1, of a second hair colour. */
  readonly streak?: number;
  /** The age at which hair starts to grey and the age at which it all has. */
  readonly grey?: Span;
  /** Each sex's chance of a beard, 0 to 1. */
  readonly beard: { readonly men: number; readonly women: number };
  readonly brows?: readonly number[];
  /** The range every body region is drawn in, and the regions drawn in their own (by REGION_KEYS). */
  readonly build: Span;
  readonly regions?: Readonly<Record<string, Span>>;
  /** How far each face modifier strays from neutral at most, 0 to 1. */
  readonly face: number;
  readonly age: Span;
  readonly weight: Span;
  readonly muscle: Span;
  /** Growth past the modelled style, 0 to 1 of the most a look holds. */
  readonly hairLength?: Span;
  readonly beardLength?: Span;
  /** What its people may wear, each set of pieces by weight. */
  readonly outfits?: readonly { readonly wear: readonly string[]; readonly weight: number }[];
}

const FIELDS = {
  label: f("text"),
  women: f("number"),
  skin: f("list"),
  eyes: f("list"),
  complexions: f("list"),
  hair: f("facet"),
  hairColors: f("list"),
  streak: f("number"),
  grey: f("list"),
  beard: f("facet"),
  brows: f("list"),
  build: f("list"),
  regions: f("facet"),
  face: f("number"),
  age: f("list"),
  weight: f("list"),
  muscle: f("list"),
  hairLength: f("list"),
  beardLength: f("list"),
  outfits: f("list", "", { refs: { "[].wear[]": ["item/armor", "item/garment"] } }),
} satisfies Fields<PopulationDef>;

const share = (v: unknown): boolean => typeof v === "number" && v >= 0 && v <= 1;
const span = (v: unknown, lo = -1): boolean => Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === "number" && n >= lo && n <= 1) && v[0] <= v[1];
/** Weights for at most `n` choices, at least one of them above 0. */
const weights = (v: unknown, n: number): boolean => Array.isArray(v) && v.length <= n && v.every((w) => typeof w === "number" && w >= 0 && w <= 1e6) && v.some((w) => w > 0);

export const populations: Kind<PopulationDef> = {
  type: "population",
  fields: FIELDS,
  rows: [
    row("population", "population", FIELDS, {
      ark: "", shelf: "people", must: ["label", "women", "skin", "eyes", "hair", "hairColors", "beard", "build", "face", "age", "weight", "muscle"],
      may: ["complexions", "streak", "grey", "brows", "regions", "hairLength", "beardLength", "outfits"],
      doc: "Who a crowd is made of: by weight and range, each part of a person the generator draws from a seed.",
    }),
  ],
  check(d, { errors }) {
    const bad = (what: string) => errors.push(`${d.id}: ${what}`);
    if (!share(d.women)) bad("women is a share from 0 to 1");
    if (!weights(d.skin, SKIN_TONES)) bad(`skin wants weights for at most ${SKIN_TONES} tones, one above 0`);
    if (!weights(d.eyes, EYE_COLORS)) bad(`eyes wants weights for at most ${EYE_COLORS} colours, one above 0`);
    if (d.complexions !== undefined && !weights(d.complexions, COMPLEXIONS)) bad(`complexions wants weights for at most ${COMPLEXIONS}, one above 0`);
    if (!weights(d.hair?.men, HAIR_STYLES.length) || !weights(d.hair?.women, HAIR_STYLES.length)) bad(`hair wants weights for at most ${HAIR_STYLES.length} styles, for men and for women`);
    if (!weights(d.hairColors, HAIR_COLORS)) bad(`hairColors wants weights for at most ${HAIR_COLORS} colours, one above 0`);
    if (d.streak !== undefined && !share(d.streak)) bad("streak is a share from 0 to 1");
    if (d.grey !== undefined && !span(d.grey)) bad("grey is a low and a high age, from -1 to 1");
    if (!share(d.beard?.men) || !share(d.beard?.women) || BEARD_STYLES.length < 2) bad("beard is each sex's share from 0 to 1");
    if (d.brows !== undefined && !weights(d.brows, BROW_STYLES)) bad(`brows wants weights for at most ${BROW_STYLES} styles, one above 0`);
    for (const [name, v] of [["build", d.build], ["age", d.age], ["weight", d.weight], ["muscle", d.muscle]] as const) if (!span(v)) bad(`${name} is a low and a high, from -1 to 1`);
    for (const [name, v] of [["hairLength", d.hairLength], ["beardLength", d.beardLength]] as const) if (v !== undefined && !span(v, 0)) bad(`${name} is a low and a high, from 0 to 1`);
    for (const [k, v] of Object.entries(d.regions ?? {})) {
      if (!REGION_KEYS.includes(k)) bad(`regions: ${k} is no body region (${REGION_KEYS.join(", ")})`);
      else if (!span(v)) bad(`regions: ${k} is a low and a high, from -1 to 1`);
    }
    if (!share(d.face)) bad("face is a share from 0 to 1");
    for (const o of d.outfits ?? []) if (!Array.isArray(o.wear) || !(typeof o.weight === "number" && o.weight > 0)) bad("an outfit is its pieces and a weight above 0");
  },
};
