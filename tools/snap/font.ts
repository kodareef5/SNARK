// A 5 by 7 bitmap font for drawing interface text into snapshots. Five bytes
// per character from space (32) to tilde (126), one byte per column, bit 0 at
// the top. It only has to be legible in a PNG; the browser uses a real font.

const HEX =
  "0000000000" + "00005f0000" + "0007000700" + "147f147f14" + "242a7f2a12" + "2313086462" + "3649552250" + "0005030000" +
  "001c224100" + "0041221c00" + "082a1c2a08" + "08083e0808" + "0050300000" + "0808080808" + "0060600000" + "2010080402" +
  "3e5149453e" + "00427f4000" + "4261514946" + "2141454b31" + "1814127f10" + "2745454539" + "3c4a494930" + "0171090503" +
  "3649494936" + "064949291e" + "0036360000" + "0056360000" + "0008142241" + "1414141414" + "4122140800" + "0201510906" +
  "324979413e" + "7e1111117e" + "7f49494936" + "3e41414122" + "7f4141221c" + "7f49494941" + "7f09090101" + "3e41415132" +
  "7f0808087f" + "00417f4100" + "2040413f01" + "7f08142241" + "7f40404040" + "7f0204027f" + "7f0408107f" + "3e4141413e" +
  "7f09090906" + "3e4151215e" + "7f09192946" + "4649494931" + "01017f0101" + "3f4040403f" + "1f2040201f" + "7f2018207f" +
  "6314081463" + "0304780403" + "6151494543" + "00007f4141" + "0204081020" + "41417f0000" + "0402010204" + "4040404040" +
  "0001020400" + "2054545478" + "7f48444438" + "3844444420" + "384444487f" + "3854545418" + "087e090102" + "081454543c" +
  "7f08040478" + "00447d4000" + "2040443d00" + "007f102844" + "00417f4000" + "7c04180478" + "7c08040478" + "3844444438" +
  "7c14141408" + "081414187c" + "7c08040408" + "4854545420" + "043f444020" + "3c4040207c" + "1c2040201c" + "3c4030403c" +
  "4428102844" + "0c5050503c" + "4464544c44" + "0008364100" + "00007f0000" + "0041360800" + "0201020402";

export const GLYPH_WIDTH = 5;
export const GLYPH_HEIGHT = 7;

const COLUMNS = new Uint8Array(HEX.length / 2);
for (let i = 0; i < COLUMNS.length; i++) COLUMNS[i] = parseInt(HEX.slice(i * 2, i * 2 + 2), 16);

/** Whether the pixel at (col, row) of `code`'s glyph is set. Unknown characters draw as a box. */
export function glyphPixel(code: number, col: number, row: number): boolean {
  if (code < 32 || code > 126) return col === 0 || col === GLYPH_WIDTH - 1 || row === 0 || row === GLYPH_HEIGHT - 1;
  return ((COLUMNS[(code - 32) * GLYPH_WIDTH + col]! >> row) & 1) !== 0;
}
