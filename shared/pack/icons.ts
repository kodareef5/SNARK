// Inventory pictures: how a build lays them out in sheets and how the manifest finds one. A picture is a square cell of
// ICON_SIZE pixels on a transparent ground, drawn by tools/pack/icons.ts from the item's mesh. A sheet is a PNG of cells
// in rows of SHEET_COLUMNS, as many rows as it needs and SHEET_ROWS at most, so that a page fetches a sheet only when it
// first shows one of its pictures and the boot file carries none of them.

/** The side of a cell, in pixels. */
export const ICON_SIZE = 128;
export const SHEET_COLUMNS = 8;
export const SHEET_ROWS = 8;
export const ICONS_A_SHEET = SHEET_COLUMNS * SHEET_ROWS;

/** A sheet: the file that holds it, and its size in cells. */
export interface IconSheet {
  /** Index into the manifest's files, one whose role is "icon". */
  file: number;
  columns: number;
  rows: number;
}

/** The pictures of a build, in the manifest from version 4. */
export interface ManifestIcons {
  /** The side of a cell, in pixels. */
  size: number;
  sheets: IconSheet[];
  /**
   * By the id of the asset an `#icon` slot names (`core:pick/icon`), its cell: `sheet * ICONS_A_SHEET + place`, the
   * place counted along rows from the top left. Pictures that are the same share a cell.
   */
  cells: Record<string, number>;
}

/** Where a cell is: its sheet, and its left and top edges in that sheet's pixels. */
export function iconAt(cell: number, size: number = ICON_SIZE): { sheet: number; x: number; y: number } {
  const place = cell % ICONS_A_SHEET;
  return { sheet: Math.floor(cell / ICONS_A_SHEET), x: (place % SHEET_COLUMNS) * size, y: Math.floor(place / SHEET_COLUMNS) * size };
}

/** The sheets `count` different pictures take, in cells across and down: every sheet full but the last. */
export function sheetShapes(count: number): { columns: number; rows: number }[] {
  const out: { columns: number; rows: number }[] = [];
  for (let left = count; left > 0; left -= ICONS_A_SHEET) {
    const here = Math.min(left, ICONS_A_SHEET);
    out.push({ columns: here < SHEET_COLUMNS ? here : SHEET_COLUMNS, rows: Math.ceil(here / SHEET_COLUMNS) });
  }
  return out;
}

/** Throws with a reason if the pictures do not fit the files they name. `role` gives each file's role by index. */
export function checkIcons(icons: ManifestIcons, role: (file: number) => string | undefined): void {
  if (icons.size !== ICON_SIZE) throw new Error(`manifest: pictures are ${String(icons.size)} pixels, not ${ICON_SIZE}`);
  if (!Array.isArray(icons.sheets) || typeof icons.cells !== "object" || icons.cells === null) throw new Error("manifest: the pictures are not described");
  for (const s of icons.sheets) {
    if (role(s.file) !== "icon") throw new Error("manifest: a sheet of pictures names a file that does not hold one");
    if (!(s.columns >= 1 && s.columns <= SHEET_COLUMNS && s.rows >= 1 && s.rows <= SHEET_ROWS)) throw new Error("manifest: a sheet of pictures is not a size a sheet can be");
  }
  for (const [id, cell] of Object.entries(icons.cells)) {
    const sheet = icons.sheets[Math.floor(cell / ICONS_A_SHEET)];
    const place = cell % ICONS_A_SHEET;
    if (!Number.isInteger(cell) || cell < 0 || !sheet || place % SHEET_COLUMNS >= sheet.columns || Math.floor(place / SHEET_COLUMNS) >= sheet.rows) throw new Error(`manifest: the picture ${id} lies outside its sheet`);
  }
}
