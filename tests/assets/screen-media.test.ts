// The default screen media (assets/source/core/screens, tools/screens/media.ts): every recipe, clip, image and channel
// against the caps, the rights and the types, the sheet `screens add` reads, the files the art release holds, and the
// copy a client build makes of them (tools/screens/starter.ts).

import { afterAll, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { COLOUR_PARTS, type Clip } from "../../shared/video/clip.ts";
import { probeImage } from "../../shared/video/image.ts";
import { probeMp4 } from "../../shared/video/mp4.ts";
import {
  IMAGE_PACK_BYTES, SCREENS_DIR, SOURCES_FILE, cacheDir, fitImage, frameColours, isItemName, itemNames, makeItem, nameOf, parseCsv, problems, readChannels, readItem, readRecipe, recipeOf,
} from "../../tools/screens/media.ts";
import { copyStarterMedia, type StarterList } from "../../tools/screens/starter.ts";
import { artTest } from "../fixtures/needs-art.ts";

const sha256 = (bytes: Uint8Array): string => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
const top = mkdtempSync(join(tmpdir(), "snark-screen-media-"));
afterAll(() => rmSync(top, { recursive: true, force: true }));
const names = itemNames();

test("every default item, recipe and channel passes the media tool's check", () => {
  expect(names.length).toBeGreaterThan(0);
  expect(problems()).toEqual([]);
});

test("every default item has a row in SOURCES.md with its licence", () => {
  const page = readFileSync(SOURCES_FILE, "utf8");
  for (const name of names) {
    const row = page.split("\n").find((line) => line.startsWith(`| ${readRecipe(name).title} |`));
    expect(row, name).toContain(`\`${name}\` \`${readItem(name)!.id}\``);
  }
});

test("no default channel holds a clip that flashes", () => {
  const flashing = names.filter((n) => readRecipe(n).flashes);
  for (const ch of readChannels()) for (const item of ch.items) expect(flashing).not.toContain(item);
  expect(flashing).toContain("lightning");
});

test("the check finds a clip with no rights, one over the caps and a channel naming none", () => {
  const dir = join(top, "bad");
  cpSync(SCREENS_DIR, dir, { recursive: true, filter: (f) => !/\.(mp4|jpg)$/.test(f) });
  const clouds = readRecipe("clouds", dir);
  writeFileSync(join(dir, "clouds/source.json"), JSON.stringify({ ...clouds, rights: "" }));
  writeFileSync(join(dir, "lightning/clip.json"), JSON.stringify({ ...readItem("lightning", dir), width: 1920, height: 1080 }));
  writeFileSync(join(dir, "channels.json"), JSON.stringify([{ name: "strip", shuffle: false, items: ["clouds", "lightning", "nothing"] }]));
  const found = problems(dir, []).join("\n");
  expect(found).toContain("clouds: source.json needs a rights line");
  expect(found).toContain("lightning: it is 1920×1080, over the caps.");
  expect(found).toContain("strip lists lightning, which flashes.");
  expect(found).toContain("strip lists nothing, which is no item.");
});

test("the check holds images, types and typed channels to the rules", () => {
  const dir = join(top, "typed");
  cpSync(SCREENS_DIR, dir, { recursive: true, filter: (f) => !/\.(mp4|jpg)$/.test(f) });
  const clouds = readRecipe("clouds", dir), item = readItem("clouds", dir)!;
  mkdirSync(join(dir, "ad"), { recursive: true });
  writeFileSync(join(dir, "ad/source.json"), JSON.stringify({ ...clouds, kind: "image", title: "Ad", types: ["billboard", "billboard"] }));
  const ad: Clip = { ...item, id: "0123456789abcdef", title: "Ad", file: "image.jpg", width: 1600, height: 400, seconds: 4, kind: "image", types: ["billboard"] };
  writeFileSync(join(dir, "ad/clip.json"), JSON.stringify(ad));
  writeFileSync(join(dir, "clouds/source.json"), JSON.stringify({ ...clouds, types: ["orb", "cinema"] }));
  writeFileSync(join(dir, "channels.json"), JSON.stringify([{ name: "strip", shuffle: false, items: ["ad"] }, { name: "road", type: "billboard", still: 200, shuffle: false, items: [] }, { name: "x", type: "cinema", shuffle: false, items: [] }]));
  const found = problems(dir, []).join("\n");
  expect(found).toContain("ad: source.json's types are one or more of orb, billboard, tv, laptop, each once.");
  expect(found).toContain("clouds: source.json's types are one or more");
  expect(found).toContain("ad: clip.json's title, rights, kind or types are not the recipe's");
  expect(found).toContain("ad: it is 1600×400, over 1280 on its long side.");
  expect(found).toContain("ad: an image has no length or sound");
  expect(found).toContain("ad: an image's colour track is one sample.");
  expect(found).toContain("channels.json: strip lists ad, which is not offered on orb screens.");
  expect(found).toContain("channels.json: road holds an image 2 to 120 seconds.");
  expect(found).toContain("channels.json: x is for orb, billboard, tv, laptop screens.");
});

test("a sheet's rows become recipes, and a row without its rights is refused", () => {
  const rows = parseCsv('File,Title,Rights,Licence,By,Channels,Poster,Audio\r\nfoo.mp4,"Dusk, over ""the"" Strip",Mine,"CC0, given",A. Person,strip; night,brightest,yes\n\nbar.mp4,Bar,,,,,,\n');
  expect(rows.length).toBe(2);
  const { name, recipe, channels } = recipeOf(rows[0]!, "ab".repeat(32));
  expect([name, recipe.title, recipe.licence, recipe.poster, recipe.audio, recipe.from.by, channels]).toEqual(["dusk-over-the-strip", 'Dusk, over "the" Strip', "CC0, given", "brightest", true, "A. Person", ["strip", "night"]]);
  expect(() => recipeOf(rows[1]!, "")).toThrow("bar.mp4: the sheet needs rights, licence, url or by.");
  expect(() => recipeOf({ ...rows[0]!, flashes: "yes" }, "")).toThrow("it flashes, so it may not be in a default channel.");
  expect([nameOf("Café — Night #2!"), isItemName("cafe-night-2"), isItemName("Bad_Name"), isItemName("-x")]).toEqual(["cafe-night-2", true, false, false]);
});

test("a sheet's image row takes its kind from the file, its types and its format", () => {
  const base = { title: "Raptor-Rid", rights: "Made for SNARK", licence: "CC0 1.0", by: "A. Person" };
  const png = recipeOf({ ...base, file: "ad.PNG", types: "tv; billboard", format: "png" }, "");
  expect([png.recipe.kind, png.recipe.types, png.recipe.format]).toEqual(["image", ["billboard", "tv"], "png"]);
  // An image with no types is offered on every type but the ball; a clip on every type.
  const jpg = recipeOf({ ...base, file: "ad.jpg", format: "jpg" }, "");
  expect([jpg.recipe.kind, jpg.recipe.types, jpg.recipe.format]).toEqual(["image", ["billboard", "tv", "laptop"], undefined]);
  const clip = recipeOf({ ...base, file: "ad.mp4" }, "");
  expect([clip.recipe.kind, clip.recipe.types]).toEqual([undefined, undefined]);
  expect(recipeOf({ ...base, file: "still.bin", kind: "Image" }, "").recipe.kind).toBe("image");
  expect(() => recipeOf({ ...base, file: "ad.png", types: "cinema" }, "")).toThrow("its types are some of");
  expect(() => recipeOf({ ...base, file: "ad.mp4", format: "png" }, "")).toThrow("only an image has a format");
  expect(() => recipeOf({ ...base, file: "ad.mp4", kind: "gif" }, "")).toThrow("its kind is clip or image");
  expect([fitImage(4000, 1000), fitImage(640, 360), fitImage(1000, 3000)]).toEqual([[1280, 320], [640, 360], [427, 1280]]);
});

test("colours are averaged in linear light, each edge from its own band", () => {
  // 16 × 8: the left half white, the right half black. Half the light is sRGB 188, not 128.
  const w = 16, h = 8, rgb = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w / 2; x++) rgb.fill(255, (y * w + x) * 3, (y * w + x) * 3 + 3);
  const [mean, top, right, bottom, left] = [0, 1, 2, 3, 4].map((p) => frameColours(rgb, w, h)[p * 3]);
  expect([mean, top, right, bottom, left]).toEqual([188, 188, 0, 188, 255]);
  expect(frameColours(rgb, w, h).length).toBe(COLOUR_PARTS * 3);
});

artTest("each clip and poster is installed with the stated bytes, and passes the server's MP4 check", () => {
  for (const name of names) {
    const c = readItem(name)!, bytes = readFileSync(join(SCREENS_DIR, name, c.file));
    expect(bytes.length).toBe(c.bytes);
    expect(sha256(bytes).slice(0, 16)).toBe(c.id);
    expect(readFileSync(join(SCREENS_DIR, name, c.poster)).length).toBeLessThanOrEqual(40 * 1024);
    const probe = probeMp4(new Uint8Array(bytes));
    if (typeof probe === "string") throw new Error(`${name}: ${probe}`);
    expect([probe.width, probe.height, probe.audio, probe.faststart]).toEqual([c.width, c.height, c.audio, true]);
    expect(probe.seconds).toBeCloseTo(c.seconds, 1);
  }
});

artTest("a build copies the clips under hashed names and lists them with the channels", () => {
  const dist = join(top, "dist");
  expect(copyStarterMedia(SCREENS_DIR, dist)).toBe(names.length);
  const starter = JSON.parse(readFileSync(join(dist, "media/starter.json"), "utf8")) as StarterList;
  const idOf = new Map(names.map((n) => [n, readItem(n)!.id]));
  expect(starter.channels).toEqual(readChannels().map((ch) => ({ name: ch.name, shuffle: ch.shuffle, items: ch.items.map((n) => idOf.get(n)!), ...(ch.type ? { type: ch.type } : {}), ...(ch.still ? { still: ch.still } : {}) })));
  for (const [i, c] of starter.clips.entries()) {
    expect(c.file).toBe(`/media/${names[i]}.${c.id}.${c.kind === "image" ? c.file.split(".").pop() : "mp4"}`);
    expect(c.poster).toMatch(/^\/media\/[a-z0-9-]+\.[0-9a-f]{16}\.jpg$/);
    for (const served of [c.file, c.poster]) expect(served).toContain(`.${sha256(readFileSync(join(dist, served))).slice(0, 16)}.`);
  }
});

test("a build lists images and typed channels in starter.json", () => {
  const from = join(top, "with-image"), dist = join(top, "dist-image");
  cpSync(SCREENS_DIR, from, { recursive: true, filter: (f) => !/\.(mp4|jpg)$/.test(f) });
  for (const f of ["clip.mp4", "poster.jpg"]) writeFileSync(join(from, "clouds", f), "stand-in");
  mkdirSync(join(from, "ad"), { recursive: true });
  const clouds = readItem("clouds", from)!;
  const ad: Clip = { ...clouds, id: "0123456789abcdef", title: "Ad", file: "image.png", seconds: 0, bytes: 90_000, colours: Buffer.alloc(COLOUR_PARTS * 3).toString("base64"), kind: "image", types: ["billboard", "tv"] };
  writeFileSync(join(from, "ad/source.json"), JSON.stringify({ ...readRecipe("clouds", from), kind: "image", title: "Ad", format: "png", types: ["billboard", "tv"] }));
  writeFileSync(join(from, "ad/clip.json"), JSON.stringify(ad));
  for (const f of ["image.png", "poster.jpg"]) writeFileSync(join(from, "ad", f), `ad ${f}`);
  writeFileSync(join(from, "channels.json"), JSON.stringify([{ name: "strip", shuffle: false, items: ["clouds"] }, { name: "roadside", type: "billboard", still: 6, shuffle: true, items: ["ad", "clouds"] }]));
  expect(problems(from, [])).toEqual([]);
  expect(copyStarterMedia(from, dist)).toBe(2);
  const starter = JSON.parse(readFileSync(join(dist, "media/starter.json"), "utf8")) as StarterList;
  const image = starter.clips.find((c) => c.title === "Ad")!;
  expect(image).toMatchObject({ kind: "image", seconds: 0, types: ["billboard", "tv"] });
  expect(image.file).toMatch(/^\/media\/ad\.[0-9a-f]{16}\.png$/);
  expect(readFileSync(join(dist, image.file), "utf8")).toBe("ad image.png");
  expect(starter.channels).toEqual([{ name: "strip", shuffle: false, items: [clouds.id] }, { name: "roadside", shuffle: true, items: [ad.id, clouds.id], type: "billboard", still: 6 }]);
});

test.skipIf(!Bun.which("ffmpeg"))("an image is fitted, never upscaled, made under the pack's cap, and passes the server's check", async () => {
  const dir = join(top, "made"), cache = join(top, "cache"), was = process.env.SNARK_CACHE;
  process.env.SNARK_CACHE = cache;
  try {
    mkdirSync(cacheDir(), { recursive: true });
    const make = async (name: string, size: string, format?: "png"): Promise<Clip> => {
      const src = join(top, `${name}.png`);
      const p = Bun.spawn(["ffmpeg", "-nostdin", "-loglevel", "error", "-y", "-f", "lavfi", "-i", `testsrc=size=${size}:rate=1`, "-frames:v", "1", src], { stderr: "pipe" });
      expect(await p.exited).toBe(0);
      const sha = new Bun.CryptoHasher("sha256").update(readFileSync(src)).digest("hex");
      writeFileSync(join(cacheDir(), `${sha}.png`), readFileSync(src));
      mkdirSync(join(dir, name), { recursive: true });
      const { recipe } = recipeOf({ file: `${name}.png`, title: name, rights: "Made for the test, CC0", licence: "Made for the test and given under CC0 1.0.", by: "the test", ...(format ? { format } : {}) }, sha);
      writeFileSync(join(dir, name, "source.json"), JSON.stringify(recipe));
      return makeItem(name, dir);
    };
    const big = await make("big", "2000x700"), small = await make("small", "301x151", "png");
    expect([big.width, big.height, big.file, big.kind, big.seconds]).toEqual([1280, 448, "image.jpg", "image", 0]);
    expect([small.width, small.height, small.file]).toEqual([301, 151, "image.png"]);
    for (const [name, c] of [["big", big], ["small", small]] as const) {
      const bytes = new Uint8Array(readFileSync(join(dir, name, c.file)));
      expect(bytes.length).toBeLessThanOrEqual(IMAGE_PACK_BYTES);
      expect(sha256(bytes).slice(0, 16)).toBe(c.id);
      expect(probeImage(bytes)).toMatchObject({ width: c.width, height: c.height });
      expect(Buffer.from(c.colours, "base64").length).toBe(COLOUR_PARTS * 3);
      expect(readFileSync(join(dir, name, "poster.jpg")).length).toBeLessThanOrEqual(40 * 1024);
    }
    expect(problems(dir, [])).toEqual([]);
    // The same original makes the same bytes again.
    expect((await makeItem("big", dir)).id).toBe(big.id);
  } finally {
    if (was === undefined) delete process.env.SNARK_CACHE;
    else process.env.SNARK_CACHE = was;
  }
});

test("a build leaves out a clip whose art is missing, and writes nothing with none", () => {
  const from = join(top, "half"), dist = join(top, "dist-half");
  cpSync(SCREENS_DIR, from, { recursive: true, filter: (f) => !/\.(mp4|jpg)$/.test(f) });
  for (const f of ["clip.mp4", "poster.jpg"]) writeFileSync(join(from, "lightning", f), "stand-in");
  expect(copyStarterMedia(from, dist)).toBe(1);
  const starter = JSON.parse(readFileSync(join(dist, "media/starter.json"), "utf8")) as StarterList;
  // The strip held only clouds, whose art is missing, so it is left out with it.
  expect([starter.clips.map((c) => c.title), starter.channels]).toEqual([["Lightning storm over Colorado"], []]);
  rmSync(join(from, "lightning"), { recursive: true });
  mkdirSync(join(dist, "media"), { recursive: true });
  expect(copyStarterMedia(from, dist)).toBe(0);
  expect(existsSync(join(dist, "media"))).toBe(false);
  expect(copyStarterMedia(join(top, "nowhere"), join(top, "dist-none"))).toBe(0);
  expect(readdirSync(top)).not.toContain("dist-none");
});
