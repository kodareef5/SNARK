// Colours the game holds or will hold, each a name and an sRGB colour: what the palette's natural tones were fitted
// to (the first six groups), and what tests/assets/palette.test.ts holds the palette to.

type Targets = readonly (readonly [string, string])[];

/** The dodo's suggested colour set (assets/source/core/creatures/dodo/ref/DESIGN.md), as the concept meant each tone. */
export const DODO: Targets = [
  ["body slate blue-grey", "6B737A"], ["body ash grey", "8E8B85"], ["body peat brown", "5A4636"], ["body dun", "9C8A6E"], ["body russet", "8A4E32"],
  ["body olive drab", "6B6A45"], ["body sooty", "3C3A38"], ["body sand", "B7A688"], ["body cream", "D8CDB4"],
  ["face rose buff", "DDA58E"], ["face flesh pink", "E3B0A3"], ["face pale ochre", "E0C07E"], ["face ivory", "EDE3CB"], ["face pale olive", "C8C28F"], ["face dusky mauve", "A88F8E"],
  ["beak olive horn", "8F8A5E"], ["beak pale horn", "B3A47A"], ["beak slate", "5D6266"], ["beak charcoal", "38393A"], ["beak umber", "5C4330"], ["beak moss", "5E6B3A"], ["beak oxblood", "6E2E2A"],
  ["brow ochre", "C4983C"], ["brow mustard", "B5A03E"], ["brow dull orange", "C47A3E"], ["brow olive", "7D7A44"], ["brow slate", "666C70"], ["brow umber", "5C4632"], ["brow dull pink", "B98576"],
  ["hood umber-charcoal", "3B302A"], ["hood chestnut", "6B3B25"], ["hood sooty", "2C2A28"], ["hood peat brown", "5A4636"], ["hood slate", "4E555B"], ["hood ash", "8E8B85"], ["hood white", "E9E6DD"],
  ["bars cream", "E6DCC4"], ["bars pale buff", "D9C49A"], ["bars ash white", "D3D3CC"], ["bars rust", "A8573A"], ["bars pale olive", "B9B68A"], ["bars pale blue-grey", "A9B6C2"], ["bars sooty", "2F2D2B"],
];

/**
 * The mean base colour, as light, of every material with pictures in the repository and in the stone and wood tiers
 * (what tools/art/materials.ts reads a flat colour off), and the colours the wood tier's design gives its materials.
 */
export const MATERIALS: Targets = [
  ["thatch thatch", "C0A873"], ["thatch mat", "B2A076"], ["thatch pole", "85725A"], ["thatch cord", "776140"],
  ["test wood", "776A5E"], ["test feather", "C8C2B8"], ["example crate planks", "84623D"], ["example pup hide", "C3C3C3"],
  ["stone masonry", "9D978B"], ["stone flags", "858179"], ["stone dressed", "CEC6B4"], ["stone timber", "785F47"], ["stone iron", "2C2927"],
  ["wood boards", "AD8153"], ["wood deck", "A98C67"], ["wood timber", "63442E"], ["wood fittings", "8E7458"],
  ["wood design boards", "AC8052"], ["wood design darker board", "A0754B"], ["wood design lighter board", "B88D60"], ["wood design rubbed timber", "765237"],
  ["wood design end grain", "BA956B"], ["wood design pegs", "B18E60"], ["wood design iron", "302D29"], ["wood design polished iron", "5A554B"],
];

/** Hides, fur, feathers, scales, skin and bare parts: what the next creatures are drawn in. */
export const CREATURES: Targets = [
  ["black fur", "1C1918"], ["sooty brown-black", "2D2621"], ["dark chocolate", "3E2C22"], ["seal brown", "4A3428"], ["chestnut", "784228"],
  ["red fox", "B05A2A"], ["rufous", "A85230"], ["cinnamon", "96623C"], ["tawny", "BE925A"], ["fawn", "AA8058"], ["buff", "D6B684"],
  ["cream wool", "E6DCC4"], ["dun", "B09870"], ["grizzled grey-brown", "807668"], ["wolf grey", "96928C"], ["silver fur", "BEBCB8"],
  ["blue-grey fur", "787C84"], ["white fur", "ECE8E0"], ["camel", "C19A6B"], ["bison brown", "523A28"], ["beaver brown", "664832"],
  ["goat off-white", "DCCEAA"], ["raven", "1E1E24"], ["pigeon slate", "6C727E"], ["dove grey", "A09C98"], ["barn owl buff", "D6AA6E"],
  ["tawny owl", "8C603C"], ["hawk brown", "694E37"], ["sparrow brown", "806246"], ["mottled duck", "78644E"], ["pheasant copper", "A05028"],
  ["robin breast", "D26E3C"], ["heron grey-blue", "8C96A0"], ["egret white", "F2F0EA"], ["emu grey-brown", "5F554B"],
  ["lizard olive", "64683C"], ["khaki green", "828056"], ["sage scales", "8C9478"], ["dark green scales", "34462C"], ["moss green hide", "566838"],
  ["crocodile grey-green", "585E4A"], ["sand lizard", "B6A078"], ["desert hide", "967856"], ["dark olive brown", "4C422C"], ["grey-brown hide", "686054"],
  ["red-brown hide", "804834"], ["belly cream-yellow", "D6CCA0"], ["shell olive-brown", "605434"], ["snake yellow-olive", "A09650"], ["banded dark", "282A22"],
  ["frog green", "64823C"], ["toad brown", "786442"], ["fish silver", "AAB0B4"], ["fish back blue-grey", "50606E"], ["shark grey", "6E767C"],
  ["chitin brown", "5C3A22"], ["chitin black", "221E1C"], ["amber chitin", "B46E28"], ["beak yellow", "DCB43C"], ["beak orange", "DC8232"],
  ["bill black", "282626"], ["ivory horn", "DCD0AA"], ["grey horn", "78746C"], ["dark claw", "2E2A26"], ["pink leg", "DCA096"],
  ["pink skin", "E8B4A0"], ["grey skin", "807A74"], ["dark skin", "46403E"], ["wattle red", "B43232"], ["amber eye", "C88C28"], ["mouth pink-grey", "B48282"],
];

/** Woods, stones, clay, plaster, metals, fibres and what animals give: what buildings and tools are made of. */
export const BUILDING: Targets = [
  ["pine", "D6B482"], ["spruce", "DEC496"], ["oak", "AA8050"], ["weathered wood", "8C8478"], ["silvered wood", "ACA89E"], ["walnut", "5C402C"],
  ["mahogany", "6E3224"], ["cedar", "A05A3C"], ["charred wood", "28221E"], ["birch bark", "DCD6C8"], ["bamboo", "C8B46E"], ["driftwood", "B4AA96"], ["teak", "966437"],
  ["limestone", "D6CCB4"], ["chalk", "ECE8DC"], ["sandstone buff", "C8AA78"], ["red sandstone", "A86048"], ["yellow sandstone", "D2B46E"], ["granite", "8C8A88"],
  ["pink granite", "BA968C"], ["slate", "484E56"], ["basalt", "3C3C3E"], ["marble", "E6E4DE"], ["flint", "6E6C68"], ["cobble", "787670"], ["mossy stone", "6E7460"], ["concrete", "A0A09B"],
  ["brick", "A04A38"], ["dark brick", "78382C"], ["terracotta", "C46E48"], ["adobe", "BE966E"], ["mud brick", "96785A"], ["whitewash", "EEECE4"], ["lime plaster", "DED6C4"], ["mortar", "B4B0A6"],
  ["forged iron", "343230"], ["steel", "84888C"], ["rust", "8C4628"], ["dark rust", "5A3020"], ["orange rust", "B46030"], ["bronze", "8C6432"], ["copper", "B87346"],
  ["verdigris", "5A9682"], ["brass", "B49650"], ["lead", "64666A"], ["gold", "D2AA46"],
  ["straw", "D2BA78"], ["reed", "B0A06E"], ["hemp rope", "A08860"], ["linen", "D2C8B4"], ["burlap", "A0825A"], ["tan leather", "A06E46"], ["dark leather", "503626"],
  ["rawhide", "D2B48C"], ["bone", "E2D8BE"], ["ivory", "ECE2C8"], ["pelt", "78685A"], ["obsidian", "1E1C20"], ["fired clay", "BE7850"], ["wood ash", "AAA6A0"], ["charcoal", "242424"],
];

/** Soils, sand, mud, gravel, rock, snow and ice: what the ground is. */
export const GROUND: Targets = [
  ["humus", "30261E"], ["loam", "644E3A"], ["dark soil", "48382C"], ["laterite", "96482C"], ["red clay", "AA6042"], ["loess", "C4AA78"],
  ["grey clay", "969288"], ["beach sand", "E2CEA6"], ["coral sand", "ECE6D4"], ["desert sand", "D2A06E"], ["wet sand", "A08C6E"], ["mud", "4C4032"],
  ["dried mud", "AA9678"], ["gravel", "827E78"], ["volcanic ash", "5A5856"], ["volcanic rock", "643C32"], ["snow", "F0F4F8"], ["old snow", "D2D2CE"],
  ["ice", "BED6E2"], ["salt flat", "E8E4DC"], ["peat", "3C2C20"], ["trail dirt", "8C7052"], ["cliff grey", "807C74"], ["ochre rock", "BE8246"], ["red rock", "AA5A3C"],
];

/** Grass, leaves, bark, moss, lichen, fungi and dry stalks: what grows. */
export const PLANTS: Targets = [
  ["fresh grass", "64963C"], ["lush grass", "467832"], ["dry grass", "BEAA64"], ["savannah", "C8AA5A"], ["dead grass", "96825A"], ["young grass", "96B450"],
  ["conifer", "28462E"], ["dark foliage", "325028"], ["foliage", "506E32"], ["olive leaf", "6E7650"], ["sage leaf", "96A082"], ["eucalyptus", "78968C"],
  ["tropical leaf", "326E3C"], ["palm frond", "5A783C"], ["fern", "50783C"], ["autumn yellow", "D2AA3C"], ["autumn orange", "C86E28"], ["autumn red", "A03228"],
  ["dead leaves", "825A37"], ["grey bark", "6E6860"], ["brown bark", "5A4636"], ["dark bark", "362C26"], ["pine bark", "8C5038"], ["moss", "5A6E32"],
  ["dark moss", "384624"], ["grey lichen", "A0AA8C"], ["yellow lichen", "C8BE5A"], ["orange lichen", "D28232"], ["algae", "46643C"], ["seaweed", "5A5028"],
  ["kelp", "6E5028"], ["pale mushroom", "DCC8AA"], ["brown mushroom", "8C6446"], ["hay", "CEB46E"], ["dry reeds", "AAA06E"],
];

/** The browns, tans and greys D167's ramp was held to as the tones an artist reaches for. */
export const EARTH_TONES: Targets = [
  "3E2E22", "5C402C", "96744E", "C4A06E", "968C7E", "96543C", "D6BE82", "B09E70", "9E926A", "6A683E", "5A643C", "E2D8C4", "BCA888", "4A3E34",
  "807E7C", "545860", "C8C2B2", "C4A47C", "303034", "ECEAE2", "B08A64", "7C5436", "463024", "6E6862", "E4D6BA", "8C7C68", "24201E",
].map((hex, i) => [`tone ${i + 1}`, hex] as const);

/** Bright things of nature, and what a player means by a colour's name: what the dyes are for. */
export const VIVID: Targets = [
  ["poppy red", "D22828"], ["cardinal red", "C41E3A"], ["tangerine", "F0821E"], ["sunflower", "F0BE1E"], ["buttercup", "FADC32"], ["bright leaf", "50AA3C"],
  ["parrot green", "28A046"], ["teal", "1E8282"], ["kingfisher", "1E82BE"], ["sky blue", "5A96D2"], ["cornflower", "6478DC"], ["violet", "7846A0"],
  ["fuchsia", "C8328C"], ["pink flower", "F096B4"], ["deep blue", "283C96"], ["berry purple", "461E46"],
];

/** Every group, by name. */
export const TARGETS: Readonly<Record<string, Targets>> = { dodo: DODO, materials: MATERIALS, creatures: CREATURES, building: BUILDING, ground: GROUND, plants: PLANTS, earth: EARTH_TONES, vivid: VIVID };

/** An entry's colour as 0..255 a channel. */
export const rgbOf = (hex: string): [number, number, number] => [0, 2, 4].map((k) => parseInt(hex.slice(k, k + 2), 16)) as [number, number, number];

/** CIELAB under D65 of an sRGB colour of 0..255 a channel. */
export function labOf(c: readonly number[]): [number, number, number] {
  const [r, g, b] = c.map((v) => (v / 255 <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4)) as [number, number, number];
  const f = (t: number): number => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  const [x, y, z] = [f((0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047), f(0.2126729 * r + 0.7151522 * g + 0.072175 * b), f((0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883)];
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

/** How far apart two sRGB colours look: the CIE76 difference, under about 5 the same colour, over 10 another shade. */
export function cie76(p: readonly number[], q: readonly number[]): number {
  const [a, b] = [labOf(p), labOf(q)];
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}
