// Meshes drawn with materials: the lighting of client/core/render/surface.ts, and the software rasterizer drawing it.
import { expect, test } from "bun:test";
import { DRAW_CUTOUT, DRAW_ONE_BONE, DRAW_TWO_SIDED } from "../../client/core/render/packet.ts";
import { AMBIENT, DIFFUSE } from "../../client/core/render/shading.ts";
import { DIELECTRIC, NEUTRAL, SKY, SUN, SURFACE_VERTEX, dyed, lit, linearToSrgb, skyShare, srgbToLinear, surfaceFragment } from "../../client/core/render/surface.ts";
import { buildRig } from "../../shared/anim/rigs.ts";
import { quatAxis } from "../../shared/math/quat.ts";
import { describePack } from "../../shared/pack/manifest.ts";
import { MATERIAL_CUTOUT, parsePack, type Pack } from "../../shared/pack/pack.ts";
import { defaultPalette } from "../../shared/pack/palette.ts";
import { Rng } from "../../shared/rng.ts";
import { packedMips } from "../../tools/pack/image.ts";
import { buildPack, type SourceMesh } from "../../tools/pack/write.ts";
import { PICK_ENTITY, PICK_SKY } from "../../tools/snap/raster.ts";
import { Stage, picture, squareMesh } from "../fixtures/stage.ts";
import { TUBE, TUBE_RIG, tubeClips, tubeMesh, tubePack, tubePictures } from "../fixtures/textured.ts";

const W = 160;
const H = 90;
const packOf = (...meshes: SourceMesh[]): Pack => parsePack(buildPack(meshes, defaultPalette()));
const plain = (...bytes: number[]) => picture(64, () => bytes);
/** One pixel of a colour, which is a whole texture of it. */
const dot = (...bytes: number[]): Uint8Array[] => [Uint8Array.from(bytes)];

/** A stage whose camera stands `back` metres in front of the middle of a square `side` metres across and looks straight at it. */
function facing(pack: Pack, side: number, back: number): Stage {
  const stage = new Stage(pack, W, H);
  [stage.cam.x, stage.cam.y, stage.cam.z, stage.cam.yaw] = [0, side / 2, back, Math.PI];
  return stage;
}

/**
 * Where the stage's camera sees a square `side` across that stands on the origin turned by `yaw`: for each pixel the
 * texture coordinate under its middle, found from the camera's ray and nothing the rasterizer worked out. NaN off the square.
 */
function seen(stage: Stage, side: number, yaw = 0): Float64Array {
  const turn = ((Math.round((yaw / (Math.PI * 2)) * 65536) & 0xffff) / 65536) * Math.PI * 2;
  const [s, c] = [Math.sin(turn), Math.cos(turn)];
  const { cam } = stage;
  const ray = [0, 0, 0];
  const out = new Float64Array(W * H * 2).fill(NaN);
  for (let i = 0; i < W * H; i++) {
    cam.ray(((i % W) + 0.5) / W, (Math.floor(i / W) + 0.5) / H, ray);
    // The square's plane goes through the origin and faces (s, 0, c).
    const t = -(cam.x * s + cam.z * c) / (ray[0]! * s + ray[2]! * c);
    const u = (c * (cam.x + ray[0]! * t) - s * (cam.z + ray[2]! * t)) / side + 0.5;
    const v = 1 - (cam.y + ray[1]! * t) / side;
    if (t > 0 && u > 0 && u < 1 && v > 0 && v < 1) out.set([u, v], i * 2);
  }
  return out;
}

/** The furthest any byte of two pictures is apart. */
function apart(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let most = a.length === b.length ? 0 : Infinity;
  for (let i = 0; i < a.length; i++) most = Math.max(most, Math.abs(a[i]! - b[i]!));
  return most;
}

test("the sun and the sky are as strong as makes a mid-grey rough surface the flat renderer's grey, in the sun and out of it", () => {
  // The flat renderer shows a colour at AMBIENT of its display value out of the sun, and at AMBIENT + DIFFUSE facing it.
  const grey = 128 / 255;
  const albedo = srgbToLinear(grey);
  const shaded = srgbToLinear(AMBIENT * grey);
  const sunlit = srgbToLinear((AMBIENT + DIFFUSE) * grey);
  // Seen and lit head on, a fully rough surface that is not metal sends back, besides its colour, DIELECTRIC of the
  // sun through a GGX of width 1 (1 / pi) and Smith's term (1 / 4), and of the sky the share its highlight takes,
  // which there is DIELECTRIC * (1 - ln 2). Out of the sun: SKY * ofSky = shaded. Facing it: that and SUN * ofSun = sunlit.
  const ofSun = albedo + DIELECTRIC / 4;
  const ofSky = albedo + DIELECTRIC * (1 - Math.log(2));
  expect(skyShare(DIELECTRIC, 1, 1)).toBeCloseTo(DIELECTRIC * (1 - Math.log(2)), 12);
  expect(SKY).toBe(Math.round((shaded / ofSky) * 1e4) / 1e4);
  expect(SUN).toBe(Math.round(((sunlit - shaded) / ofSun) * 1e4) / 1e4);

  // The functions agree, whatever colour the sky is: a rough highlight takes the sky's light as white.
  const out = [0, 0, 0];
  const front = [0, 0, 1];
  for (const sky of [[0.3, 0.5, 0.8], [0, 0, 0]]) {
    lit(out, [albedo, albedo, albedo], [1, 1, 0], front, front, front, sky);
    for (const c of out) expect(linearToSrgb(c) * 255).toBeCloseTo(128, 1);
    lit(out, [albedo, albedo, albedo], [1, 1, 0], front, front, [0, 0, -1], sky);
    for (const c of out) expect(linearToSrgb(c) * 255).toBeCloseTo(AMBIENT * 128, 1);
  }

  // Drawn: a square in palette grey, and the same square with a base colour of that grey and no other map.
  const stage = facing(packOf(squareMesh("test:grey", 1, ["base"])), 1, 1.2);
  const draw = (flat: boolean, sun: readonly number[], night: boolean): Uint8ClampedArray => {
    stage.sun = [...sun];
    stage.begin();
    if (night) {
      // A dim day, and fog that is a fifth of the way to hiding the square.
      const p = stage.packet;
      [p.light, p.fogStart, p.fogEnd] = [0.3, 0.5, 2];
      for (let k = 0; k < 3; k++) p.sky[k]! *= p.light;
    }
    stage.texture(0, "base", dot(128, 128, 128, 255));
    stage.add("test:grey", 0, { x: 0, y: 0, z: 0, flat });
    return stage.render().slice();
  };
  const middle = ((H / 2) * W + W / 2) * 4;
  for (const [sun, byte] of [[[0, 0, 1], 128], [[0, 0, -1], 70]] as const) {
    const [flat, textured] = [draw(true, sun, false), draw(false, sun, false)];
    expect([...flat.subarray(middle, middle + 3)]).toEqual([byte, byte, byte]);
    expect([...textured.subarray(middle, middle + 3)]).toEqual([byte, byte, byte]);
    expect(stage.raster.pickKind[middle / 4]).toBe(PICK_ENTITY);
    // Toward its edges the square is seen a little aslant, and reflects a little more of what is in front of it.
    expect(apart(flat, textured)).toBeLessThanOrEqual(1);
    // The day's light and the fog are the flat renderer's.
    expect(apart(draw(true, sun, true), draw(false, sun, true))).toBeLessThanOrEqual(1);
  }
});

test("the sky's share of a highlight is what the sun's highlight comes to over the whole sky", () => {
  // The sun's light in `lit`, with no colour under the highlight and no sky, summed over every place the sun could be.
  const over = (albedo: number, metal: number, rough: number, nv: number): number => {
    const out = [0, 0, 0];
    const eye = [Math.sqrt(1 - nv * nv), 0, nv];
    const n = 96;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n * 2; j++) {
        const z = (i + 0.5) / n;
        const turn = ((j + 0.5) / n) * Math.PI;
        lit(out, [albedo, albedo, albedo], [0, rough, metal], [0, 0, 1], eye, [Math.sqrt(1 - z * z) * Math.cos(turn), Math.sqrt(1 - z * z) * Math.sin(turn), z], [0, 0, 0]);
        sum += out[0]!;
      }
    }
    // Each sample stands for pi / (n n) of the sky, and the sun's strength is in terms of pi of it.
    return sum / (n * n) / SUN;
  };
  for (const [rough, nv] of [[1, 1], [1, 0.3], [0.7, 0.8], [0.7, 0.25], [0.45, 0.6], [0.45, 0.2]] as const) {
    // A white metal reflects all its highlight. A surface that is not metal reflects DIELECTRIC of it, and more at its edges.
    expect(Math.abs(skyShare(1, rough, nv) - over(1, 1, rough, nv))).toBeLessThan(0.03);
    expect(Math.abs(skyShare(DIELECTRIC, rough, nv) - over(0, 0, rough, nv))).toBeLessThan(0.015);
  }
});

test("the SURFACE program's text is written from the same numbers", () => {
  const text = surfaceFragment("bc");
  for (const n of [SUN, SKY, DIELECTRIC]) expect(text.split(String(n)).length).toBeGreaterThan(1);
  // A normal's x and y are in red and green, but in the astc variant in the colours and alpha.
  expect([text.includes("texture(uNormal, vUv).rg;"), surfaceFragment("rgba") === text, surfaceFragment("astc").includes("texture(uNormal, vUv).ra;")]).toEqual([true, true, true]);
  for (const part of [text, SURFACE_VERTEX]) {
    expect(part.startsWith("#version 300 es\n")).toBe(true);
    expect([part.split("{").length, part.split("(").length]).toEqual([part.split("}").length, part.split(")").length]);
  }
});

test("a checker on a square seen at an angle lands texel for texel, and a far square is drawn from its smaller pictures", () => {
  const pack = packOf(squareMesh("test:checker", 4, ["base"]));
  const stage = new Stage(pack, W, H);
  const yaw = 0.7;
  [stage.cam.x, stage.cam.y, stage.cam.z, stage.cam.yaw, stage.cam.pitch] = [0.9, 2.3, 2, Math.PI - 0.25, -0.12];
  stage.sun = [Math.sin(yaw), 0.2, Math.cos(yaw)];
  stage.begin();
  // Every texel is black or white, by turns.
  stage.textures("test:checker/", { base: picture(64, (x, y) => ((x + y) & 1 ? [255, 255, 255, 255] : [0, 0, 0, 255])) });
  stage.add("test:checker", 0, { x: 0, y: 0, z: 0, yaw });
  const pixels = stage.render();
  const at = seen(stage, 4, yaw);
  const bright = (i: number): number => srgbToLinear(pixels[i * 4 + 1]! / 255);
  let [darkest, lightest, covered, tested] = [1, 0, 0, 0];
  for (let i = 0; i < W * H; i++) {
    // The square covers exactly the pixels whose middles look at it.
    expect(stage.raster.pickKind[i] === PICK_ENTITY).toBe(!Number.isNaN(at[i * 2]!));
    if (Number.isNaN(at[i * 2]!)) continue;
    covered++;
    darkest = Math.min(darkest, bright(i));
    lightest = Math.max(lightest, bright(i));
  }
  for (let i = 0; i < W * H; i++) {
    const [x, y] = [at[i * 2]! * 64, at[i * 2 + 1]! * 64];
    // A pixel that looks at the middle of a texel shows mostly that texel.
    if (Number.isNaN(x) || Math.abs(x - Math.floor(x) - 0.5) > 0.2 || Math.abs(y - Math.floor(y) - 0.5) > 0.2) continue;
    tested++;
    expect(bright(i) > (darkest + lightest) / 2).toBe(((Math.floor(x) + Math.floor(y)) & 1) === 1);
  }
  expect([covered > 6000, tested > 1000, darkest < 0.05, lightest > 0.9]).toEqual([true, true, true, true]);

  // A texture whose every picture is one grey of its own says which pictures a pixel was drawn from. Seen head on from
  // `back` metres, a pixel of the screen is as wide as `back` times this many pixels of the 64 that cross the square.
  const perMetre = ((2 * Math.tan(stage.cam.fovY / 2)) / H) * (64 / 4);
  const greys = [220, 190, 160, 130, 100, 70, 40];
  const far = facing(pack, 4, 1);
  const middle = ((H / 2) * W + W / 2) * 4;
  const drawn = (texelsAcross: number, mips: Uint8Array[]): number => {
    far.cam.z = texelsAcross / perMetre;
    far.sun = [0, 0, 1];
    far.begin();
    far.texture(0, "base", mips);
    far.add("test:checker", 0, { x: 0, y: 0, z: 0 });
    return far.render()[middle]!;
  };
  // The 64-pixel picture is 220 and the one-pixel picture 40.
  const stepped = greys.map((g, k) => new Uint8Array(4 ** (6 - k) * 4).fill(g)).reverse();
  const whole = greys.map((g) => drawn(1, dot(g, g, g, g)));
  expect([0.5, 1, 2, 4, 8, 16, 32].map((across) => drawn(across, stepped))).toEqual([whole[0]!, whole[0]!, whole[1]!, whole[2]!, whole[3]!, whole[4]!, whole[5]!]);
  expect(new Set(whole).size).toBe(7);
  // Between two sizes it is drawn from both pictures, as light: at 2.83 texels to the pixel, half from each.
  const half = linearToSrgb((srgbToLinear(whole[1]! / 255) + srgbToLinear(whole[2]! / 255)) / 2) * 255;
  expect(Math.abs(drawn(2 ** 1.5, stepped) - half)).toBeLessThan(1);
});

test("each mask channel dyes with its own region's colour, and what the weights leave of 1 keeps the base colour", () => {
  const out = [0, 0, 0];
  const dyes = Array.from({ length: 18 }, (_, i) => 0.1 + i * 0.05);
  for (let k = 0; k < 6; k++) {
    const weights = Array.from({ length: 6 }, (_, j) => (j === k ? 1 : 0));
    dyed(out, [1, 0.5, 0.25], [1, 1, 2], dyes, weights.slice(0, 3), weights.slice(3));
    expect(apart(out, [dyes[k * 3]!, dyes[k * 3 + 1]! * 0.5, dyes[k * 3 + 2]! * 0.5])).toBeLessThan(1e-12);
  }
  // Half in region 0 and half in region 5 is the even mix of the two. A quarter in region 1 leaves three quarters as they were.
  dyed(out, [1, 1, 1], [1, 1, 1], dyes, [0.5, 0, 0], [0, 0, 0.5]);
  expect(apart(out, [0, 1, 2].map((c) => (dyes[c]! + dyes[15 + c]!) / 2))).toBeLessThan(1e-12);
  dyed(out, [1, 1, 1], [1, 1, 1], dyes, [0, 0.25, 0], [0, 0, 0]);
  expect(apart(out, [0, 1, 2].map((c) => 0.75 + dyes[3 + c]! / 4))).toBeLessThan(1e-12);
});

test("a region's colour dyes the pixels its mask covers and no others, and a pixel half in two regions is the even mix of their colours", () => {
  // Four bands from left to right: region 0, region 1, half of each, and a band that is region 3 in its lower half
  // and never dyed in its upper. The base is one light grey, and the material's grey is that grey as light.
  const light = 200;
  const pack = packOf(squareMesh("test:dyed", 4, ["base", "mask", "mask2"], { grey: srgbToLinear(light / 255) }));
  const stage = facing(pack, 4, 3);
  stage.sun = [0, 0, 1];
  const band = (x: number): number => x >> 4;
  const maps = {
    base: plain(light, light, light, 255),
    mask: picture(64, (x) => [[255, 0, 0, 255], [0, 255, 0, 255], [128, 127, 0, 255], [0, 0, 0, 255]][band(x)]!),
    mask2: picture(64, (x, y) => (band(x) === 3 && y >= 32 ? [255, 0, 0, 255] : [0, 0, 0, 255])),
  };
  const draw = (...regions: number[]): Uint8ClampedArray => {
    stage.begin();
    stage.textures("test:dyed/", maps);
    stage.add("test:dyed", 0, { x: 0, y: 0, z: 0, regions });
    return stage.render().slice();
  };
  const [red, teal, green] = [8, 9, 7];
  const first = draw(red, teal, 0, red);
  const second = draw(red, green, 0, red);
  const allRed = draw(red, red, red, red, red, red);
  const allTeal = draw(teal, teal, teal, teal, teal, teal);
  const at = seen(stage, 4);
  const counts = [0, 0, 0, 0, 0];
  for (let i = 0; i < W * H; i++) {
    const [x, y] = [at[i * 2]! * 64, at[i * 2 + 1]! * 64];
    // Pixels within a texel of where two bands meet show some of each.
    if (Number.isNaN(x) || Math.abs(x - Math.round(x / 16) * 16) < 1 || (x > 47 && Math.abs(y - 32) < 1)) continue;
    const pixel = (p: Uint8ClampedArray): number[] => [...p.subarray(i * 4, i * 4 + 3)];
    const where = band(Math.floor(x)) + (x > 48 && y < 32 ? 1 : 0);
    counts[where]!++;
    // Changing region 1 from teal to green changes the bands that have some of it.
    expect(apart(pixel(first), pixel(second)) > 0).toBe(where === 1 || where === 2);
    if (where === 0 || where === 3) expect(pixel(first)).toEqual(pixel(allRed));
    if (where === 1) expect(pixel(first)).toEqual(pixel(allTeal));
    // 128 and 127 of 255 are the two halves.
    if (where === 2) expect(apart(pixel(first), [0, 1, 2].map((c) => linearToSrgb((srgbToLinear(pixel(allRed)[c]! / 255) * 128 + srgbToLinear(pixel(allTeal)[c]! / 255) * 127) / 255) * 255))).toBeLessThan(1);
    // What no mask covers is the base colour whatever the regions are: grey.
    if (where === 4) expect([pixel(allRed), pixel(allTeal), pixel(first)[0]]).toEqual([pixel(first), pixel(first), pixel(first)[2]!]);
  }
  expect(counts.every((n) => n > 500)).toBe(true);
  // A dyed band is the palette colour as the flat renderer would light it, to within what the two ways of lighting differ by off mid grey.
  const middle = (60 * W + 40) * 4;
  expect(apart(allRed.subarray(middle, middle + 3), pack.palette.subarray(red * 4, red * 4 + 3))).toBeLessThan(8);
});

test("a mirrored texture island lights the same as its twin", () => {
  // The right half shows the left half's picture mirrored. The normal map leans every normal toward the picture's right and top.
  const pack = packOf(squareMesh("test:twin", 2, ["base", "normal", "mro"], {}, true));
  const stage = facing(pack, 2, 1.8);
  const maps = {
    base: picture(64, (x, y) => [40 + x * 3, 200 - y * 2, 120, 255]),
    normal: plain(128 + 60, 128 + 40, 255, 255),
    mro: plain(255, 110, 0, 255),
  };
  const draw = (sun: number[]): Uint8ClampedArray => {
    stage.sun = sun;
    stage.begin();
    stage.textures("test:twin/", maps);
    stage.add("test:twin", 0, { x: 0, y: 0, z: 0 });
    return stage.render().slice();
  };
  const mirror = (pixels: Uint8ClampedArray): Uint8ClampedArray => {
    const out = new Uint8ClampedArray(pixels.length);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) out.set(pixels.subarray((y * W + x) * 4, (y * W + x) * 4 + 4), (y * W + W - 1 - x) * 4);
    return out;
  };
  // Lit from straight ahead and above, the two halves are each other's mirror image.
  const even = draw([0, 0.6, 0.8]);
  expect(apart(even, mirror(even))).toBeLessThanOrEqual(1);
  // Lit from the right, the half whose normals lean right is the brighter by far.
  const fromRight = draw([0.7, 0.3, 0.65]);
  const [left, right] = [(45 * W + 50) * 4 + 1, (45 * W + 109) * 4 + 1];
  expect(fromRight[left]! - fromRight[right]!).toBeGreaterThan(25);
});

test("the bent tube has no crack, and with every weight on one bone it is drawn as with one bone a vertex", () => {
  const rig = buildRig(TUBE_RIG, { clips: [], index: new Map(), hash: 0 })!;
  const draw = (pack: Pack, bend: number, flags = 0, level = 0): Stage => {
    const stage = new Stage(pack, W, H);
    [stage.cam.x, stage.cam.y, stage.cam.z, stage.cam.yaw, stage.cam.pitch] = [2, 1.3, 0.5, -Math.PI / 2, -0.05];
    stage.begin();
    stage.textures(`${TUBE}/`, tubePictures());
    const bone = stage.pose(rig, { x: 0, y: 0, z: 0 }, (rot) => quatAxis(rot, 4, 1, 0, 0, bend));
    stage.add(TUBE, level, { x: 0, y: 0, z: 0, bone, regions: [8, 9, 6, 5], flags });
    stage.render();
    return stage;
  };
  const whole = parsePack(tubePack());
  // Seen from its side, bent forward by 60 degrees, at both levels that have a surface.
  for (const level of [0, 1]) {
    const { raster } = draw(whole, Math.PI / 3, 0, level);
    const sky = Array.from(raster.pickKind, (kind) => kind === PICK_SKY);
    let covered = 0;
    // Every row of the picture crosses the tube once.
    for (let y = 0; y < H; y++) {
      let runs = 0;
      for (let x = 0; x < W; x++) {
        if (sky[y * W + x]) continue;
        covered++;
        if (x === 0 || sky[y * W + x - 1]) runs++;
      }
      expect(runs).toBeLessThanOrEqual(1);
    }
    expect(covered).toBeGreaterThan(900);
    // And there is no sky that cannot be reached from the corner of the picture: no hole.
    const reach = [0];
    sky[0] = false;
    while (reach.length > 0) {
      const i = reach.pop()!;
      for (const next of [i - W, i + W, i % W > 0 ? i - 1 : -1, i % W < W - 1 ? i + 1 : -1]) {
        if (!sky[next]) continue;
        sky[next] = false;
        reach.push(next);
      }
    }
    expect(sky.includes(true)).toBe(false);
    // Both bones are followed.
    expect(new Set(raster.pickBone)).toEqual(new Set([0, 1, 2]));
  }

  // The same tube with each vertex wholly on its own bone, and with no skin entries at all.
  const variant = (change: (lod: SourceMesh["lods"][number]) => void): Pack => {
    const mesh = tubeMesh();
    mesh.lods.forEach(change);
    return parsePack(buildPack([mesh], defaultPalette(), tubeClips(), [TUBE_RIG]));
  };
  const snapped = variant((lod) => {
    lod.joints = Uint8Array.from(lod.joints!, (_, i) => (i % 4 === 0 ? lod.bones![i >> 2]! : 0));
    lod.weights = Float32Array.from(lod.weights!, (_, i) => (i % 4 === 0 ? 1 : 0));
  });
  const boneless = variant((lod) => {
    delete lod.joints;
    delete lod.weights;
  });
  expect([whole, snapped, boneless].map((p) => p.header.meshes[0]!.lods[0]!.skinOffset !== undefined)).toEqual([true, true, false]);
  const [smooth, hard, rigid] = [draw(whole, Math.PI / 3).raster, draw(snapped, Math.PI / 3).raster, draw(boneless, Math.PI / 3).raster];
  expect([hard.color, hard.depth, hard.pickBone]).toEqual([rigid.color, rigid.depth, rigid.pickBone]);
  expect(apart(smooth.color, hard.color)).toBeGreaterThan(50);

  // A body the frame had no bones for is drawn in its rest pose on its first bone, however it is bent.
  expect(apart(draw(whole, Math.PI / 3, DRAW_ONE_BONE).raster.color, draw(whole, 0).raster.color)).toBeLessThanOrEqual(1);
});

test("a far, shrunk normal-mapped surface does not sparkle more than a near one, because its roughness was raised", () => {
  // A smooth grey surface whose every texel leans its own way, lit from where the camera stands.
  const pack = packOf(squareMesh("test:bumpy", 4, ["base", "normal", "mro"]));
  const rng = new Rng(7);
  const maps = {
    base: plain(128, 128, 128, 255),
    normal: picture(64, () => [128 + rng.range(-60, 60), 128 + rng.range(-60, 60), 255, 255]),
    mro: plain(255, 80, 0, 255),
  };
  const stage = facing(pack, 4, 1);
  stage.sun = [0, 0, 1];
  /** The brightest green on the square, and the mean. */
  const draw = (back: number, mro?: Uint8Array[]): { peak: number; mean: number } => {
    stage.cam.z = back;
    stage.begin();
    stage.textures("test:bumpy/", maps);
    if (mro) stage.texture(pack.header.textures!.findIndex((t) => t.role === "mro"), "mro", mro);
    stage.add("test:bumpy", 0, { x: 0, y: 0, z: 0 });
    const pixels = stage.render();
    let [peak, sum, n] = [0, 0, 0];
    for (let i = 0; i < W * H; i++) {
      if (stage.raster.pickKind[i] !== PICK_ENTITY) continue;
      peak = Math.max(peak, pixels[i * 4 + 1]!);
      sum += pixels[i * 4 + 1]!;
      n++;
    }
    return { peak, mean: sum / n };
  };
  // Near, a texel is two pixels wide, and the few that lean just right flash.
  const near = draw(2);
  expect(near.peak - near.mean).toBeGreaterThan(100);
  // Far, eight texels by eight share a pixel. Nothing flashes, and the square is as bright as it was near.
  const far = draw(32);
  expect(far.peak - far.mean).toBeLessThan(5);
  expect(Math.abs(far.mean - near.mean)).toBeLessThan(6);
  // With a packed map averaged as it is, the far square would be a smooth mirror of the sun.
  const mirror = draw(32, packedMips(maps.mro));
  expect(mirror.mean - near.mean).toBeGreaterThan(50);
});

test("a two-sided material shows its back lit as its other side, and a cut-out one shows nothing where its alpha is under the cutoff", () => {
  // The left half of the picture is opaque and the right half is not.
  const pack = packOf(squareMesh("test:leaf", 1, ["base"], { cutoff: 0.5, flags: MATERIAL_CUTOUT }));
  const base = picture(64, (x) => [128, 128, 128, x < 32 ? 255 : 60]);
  const stage = facing(pack, 1, 1.2);
  const draw = (flags: number, behind = false): Uint8ClampedArray => {
    [stage.cam.z, stage.cam.yaw] = behind ? [-1.2, 0] : [1.2, Math.PI];
    stage.sun = [0, 0, behind ? -1 : 1];
    stage.begin();
    stage.textures("test:leaf/", { base });
    stage.add("test:leaf", 0, { x: 0, y: 0, z: 0, flags });
    // The stage sets the flags the material calls for. This test sets its own.
    stage.packet.drawFlags[0] = (stage.packet.drawFlags[0]! & ~(DRAW_CUTOUT | DRAW_TWO_SIDED)) | flags;
    return stage.render().slice();
  };
  const [left, right] = [45 * W + 60, 45 * W + 100];
  const kinds = (): number[] => [stage.raster.pickKind[left]!, stage.raster.pickKind[right]!];
  const whole = draw(0);
  expect(kinds()).toEqual([PICK_ENTITY, PICK_ENTITY]);
  const cut = draw(DRAW_CUTOUT);
  expect(kinds()).toEqual([PICK_ENTITY, PICK_SKY]);
  expect([cut[left * 4], cut[right * 4], stage.raster.depth[right]]).toEqual([whole[left * 4]!, Math.round(stage.packet.sky[0]! * 255), Infinity]);
  // From behind there is nothing, unless both faces show. Then the back faces the sun there, and is the lit grey.
  draw(DRAW_CUTOUT, true);
  expect(kinds()).toEqual([PICK_SKY, PICK_SKY]);
  const back = draw(DRAW_CUTOUT | DRAW_TWO_SIDED, true);
  // Seen from behind, the opaque half is on the right.
  expect(kinds()).toEqual([PICK_SKY, PICK_ENTITY]);
  expect([back[right * 4], whole[left * 4]]).toEqual([128, 128]);
});

test("a textured draw needs its level's surface, its base colour and its masks on the card, and takes a missing normal or packed map as neutral", () => {
  const whole = parsePack(tubePack());
  const rig = buildRig(TUBE_RIG, { clips: [], index: new Map(), hash: 0 })!;
  const mips = new Stage(whole);
  const frame = (stage: Stage, setup: () => void = () => {}): Uint8ClampedArray => {
    [stage.cam.x, stage.cam.y, stage.cam.z, stage.cam.yaw] = [0, 1, 2.6, Math.PI];
    stage.begin();
    setup();
    const bone = stage.pose(rig, { x: 0, y: 0, z: 0 }, (rot) => quatAxis(rot, 4, 1, 0, 0, 0.5));
    stage.add(TUBE, 0, { x: 0, y: 0, z: 0, bone, regions: [8, 9, 6, 5], slot: 5 });
    return stage.render().slice();
  };
  const all = frame(mips, () => mips.textures(`${TUBE}/`, tubePictures()));
  const slot = (role: string): number => whole.header.textures!.findIndex((t) => t.role === role);

  // A texture is what its slot draws with once the upload marked `last` has come, and no sooner.
  const uploads = mips.packet.texUploads.slice();
  const end = uploads.findIndex((u) => u.slot === slot("base") && u.last);
  const stage = new Stage(whole);
  expect(() => frame(stage)).toThrow("whose base texture is not on the graphics card");
  expect(() => frame(stage, () => stage.packet.texUploads.push(...uploads.filter((_, k) => k !== end)))).toThrow("whose base texture is not on the graphics card");
  expect(frame(stage, () => stage.packet.texUploads.push(uploads[end]!))).toEqual(all);
  // A texture is made again a few rows at a time while the old one goes on being drawn. Here the base colour turns white.
  const white = new Uint8Array(64 * 64 * 4).fill(255);
  const rows = (row: number, n: number, last: boolean) => ({ slot: slot("base"), role: "base" as const, format: "rgba" as const, top: 64, size: 64, row, rows: n, data: white.subarray(0, n * 256), last });
  const small = uploads.filter((u) => u.slot === slot("base") && u.size < 64).map((u) => ({ ...u, last: false }));
  expect(frame(stage, () => stage.packet.texUploads.push(...small, rows(0, 40, false)))).toEqual(all);
  expect(apart(frame(stage, () => stage.packet.texUploads.push(rows(40, 24, true))), all)).toBeGreaterThan(20);
  expect(() => frame(stage, () => stage.packet.texUploads.push(rows(0, 40, true)))).toThrow("bytes of it not sent");
  // Dropped, it is gone.
  expect(() => frame(stage, () => stage.packet.texDrops.push(slot("mask2")))).toThrow("whose mask2 texture is not on the graphics card");

  // A normal map and a packed map still on their way read as one pixel of NEUTRAL would.
  const bare = new Stage(whole);
  const basics = uploads.filter((u) => u.role !== "normal" && u.role !== "mro");
  const without = frame(bare, () => bare.packet.texUploads.push(...basics));
  expect(apart(without, all)).toBeGreaterThan(20);
  const neutral = frame(bare, () => {
    bare.texture(slot("normal"), "normal", dot(...NEUTRAL.normal));
    bare.texture(slot("mro"), "mro", dot(...NEUTRAL.mro));
  });
  expect(neutral).toEqual(without);

  // Given a manifest, a level is what was uploaded. Its first part alone can be drawn flat and not with materials.
  const manifest = describePack(whole, { name: "tube", bytes: tubePack().length });
  const level = manifest.meshes[0]!.levels[0]!;
  const upload = (parts: number) => ({ slot: 5, mesh: 0, level: 0, indexCount: level.tris * 3, indexBytes: level.index, data: whole.blob.subarray(level.at - whole.blobAt, level.at - whole.blobAt + level.parts.slice(0, parts).reduce((n, p) => n + p.bytes, 0)) });
  const card = new Stage(whole, W, H, manifest);
  const streamed = (parts: number): Uint8ClampedArray =>
    frame(card, () => {
      card.packet.texUploads.push(...uploads);
      card.packet.assetUploads.push(upload(parts));
    });
  expect(() => streamed(1)).toThrow("the surface of its level is not on the graphics card");
  expect(streamed(3)).toEqual(all);
});
