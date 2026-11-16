import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildUiAssets } from "../../tools/ui/assets.ts";
import { fontAdvances } from "../../tools/ui/font.ts";
import { FONT_ADVANCES, FONT_UNITS } from "../../client/core/ui/font-metrics.ts";
import { fitText, textWidth, wrapText } from "../../client/core/ui/nodes.ts";
import { S_MENU_NOTE } from "../../client/core/ui/style.ts";
import { readPng } from "../../tools/pack/png-read.ts";
import { partHash } from "../../tools/pack/manifest.ts";

test("HUD export is bounded, content-addressed and carries its local font license without source art",()=>{
  const dir=mkdtempSync(join(tmpdir(),"snark-ui-"));
  try {
    const out=buildUiAssets(dir), files=readdirSync(join(dir,"assets"));
    expect(files.length).toBe(4); expect(out.bytes).toBeLessThan(96*1024); expect(out.decodedBytes).toBeLessThanOrEqual(1024*1024);
    for (const name of [out.atlas,out.font]) expect(name).toContain(partHash(readFileSync(join(dir,name))));
    const sheet=readPng(join(dir,out.atlas));
    expect([sheet.width,sheet.height,sheet.channels]).toEqual([512,448,4]);
    expect(sheet.data[(447*512+511)*4+3]).toBe(0);
    const glassAlpha=sheet.data[((256+32)*512+32)*4+3]!;
    expect(glassAlpha).toBeGreaterThan(0); expect(glassAlpha).toBeLessThan(200);
    expect(statSync(join(dir,out.atlas)).size).toBeLessThan(32*1024);
    expect(readFileSync(join(dir,"assets/hud-font-license.txt"),"utf8")).toContain("SIL OPEN FONT LICENSE");
  } finally { rmSync(dir,{recursive:true,force:true}); }
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
