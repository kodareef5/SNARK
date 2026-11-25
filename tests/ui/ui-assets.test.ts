import { spawnSync } from "node:child_process";
import { expect } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildUiAssets, hudFaces, uiSheet } from "../../tools/ui/assets.ts";
import { fontAdvances, fontCharacters } from "../../tools/ui/font.ts";
import { FONT_ADVANCES, FONT_UNITS } from "../../client/core/ui/font-metrics.ts";
import { fitText, textWidth, wrapText } from "../../client/core/ui/nodes.ts";
import { S_MENU_NOTE } from "../../client/core/ui/style.ts";
import { readPng } from "../../tools/pack/png-read.ts";
import { partHash } from "../../tools/pack/manifest.ts";
import { test } from "../fixtures/needs-art.ts";

test("HUD export is bounded, content-addressed and carries its local font license without source art",()=>{
  const dir=mkdtempSync(join(tmpdir(),"snark-ui-"));
  try {
    const out=buildUiAssets(dir), files=readdirSync(join(dir,"assets"));
    // The sheet, the font's two parts and its licence, and the touch controls' sheet, which only a touched page fetches and `bytes` leaves out.
    expect(files.length).toBe(5); expect(out.bytes).toBeLessThan(96*1024); expect(out.decodedBytes).toBeLessThanOrEqual(1024*1024);
    for (const name of [out.atlas,...out.faces.map(f=>f.url),out.touch]) expect(name).toContain(partHash(readFileSync(join(dir,name))));
    expect(out.touch).toMatch(/^assets\/touch\.[0-9a-f]+\.webp$/);
    expect(statSync(join(dir,out.touch)).size).toBeLessThan(400*1024);
    const path = join(dir, out.atlas);
    if (path.endsWith(".webp")) {
      const decoded = join(dir, "roundtrip.png");
      expect(spawnSync("dwebp", ["-quiet", path, "-o", decoded]).status).toBe(0);
    }
    const sheet = readPng(path.endsWith(".webp") ? join(dir,"roundtrip.png") : path);
    expect(Buffer.from(sheet.data).equals(Buffer.from(uiSheet().data))).toBe(true);
    expect([sheet.width,sheet.height,sheet.channels]).toEqual([512,448,4]);
    expect(sheet.data[(447*512+511)*4+3]).toBe(0);
    const glassAlpha=sheet.data[((256+32)*512+32)*4+3]!;
    expect(glassAlpha).toBeGreaterThan(0); expect(glassAlpha).toBeLessThan(200);
    expect(statSync(join(dir,out.atlas)).size).toBeLessThan(32*1024);
    // The vitals are the generated glyphs: a health cross with rounded arms is clear at its cell's corner and solid at its middle, in each of its rows.
    for (const row of [0,1,2]) expect([sheet.data[((row*64+6)*512+6)*4+3], sheet.data[((row*64+32)*512+32)*4+3]!>180]).toEqual([0,true]);
    expect(readFileSync(join(dir,"assets/hud-font-license.txt"),"utf8")).toContain("SIL OPEN FONT LICENSE");
  } finally { rmSync(dir,{recursive:true,force:true}); }
});

test("the font's parts were made from the face here, and between them hold each of its characters once", () => {
  const faces = hudFaces(), cmap = fontCharacters(join(import.meta.dir, "../../assets/raw/fonts/barlow/BarlowSemiCondensed-Medium.ttf"));
  const codes = faces.map((f) => f.range.split(", ").flatMap((r) => {
    const [a, b = a] = r.slice(2).split("-").map((h) => parseInt(h, 16));
    return Array.from({ length: b! - a! + 1 }, (_, i) => a! + i);
  }));
  expect(codes.flat().sort((a, b) => a - b)).toEqual(cmap);
  expect(codes[0]).toContain(0xe9); // é
  expect(codes[1]).toContain(0x141); // Ł
  expect(faces.map((f) => f.url)).toEqual(faces.map((f) => expect.stringMatching(/^assets\/hud-font-\w+\.[0-9a-f]{16}\.woff2$/)));
});

test("headless text uses the bundled font advances and fits narrow boxes without cutting Unicode",()=>{
  const actual=fontAdvances(join(import.meta.dir,"../../assets/raw/fonts/barlow/BarlowSemiCondensed-Medium.ttf"));
  expect(actual).toEqual({units:FONT_UNITS,advances:[...FONT_ADVANCES]});
  expect(textWidth("111",S_MENU_NOTE)).toBeLessThan(textWidth("888",S_MENU_NOTE));
  for (const width of [0,4,20,60,180]) for (const text of ["Resume", "Wiiii mmmm", "名前😀abc", "A long status warning"]) {
    const fitted=fitText(text,width,S_MENU_NOTE);
    expect(textWidth(fitted,S_MENU_NOTE)).toBeLessThanOrEqual(width);
    expect(new TextDecoder().decode(new TextEncoder().encode(fitted))).toBe(fitted);
  }
  const rows:string[]=[]; wrapText("A long word and supercalifragilistic",80,S_MENU_NOTE,rows);
  expect(rows.length).toBeGreaterThan(1);
  expect(rows.every(r=>textWidth(r,S_MENU_NOTE)<=80)).toBe(true);
});
