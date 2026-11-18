import {
  BEARD_STYLES,
  HAIR_STYLES,
  LOOK_BEARD,
  LOOK_EYE_COLOR,
  LOOK_HAIR,
  LOOK_HAIR_COLOR,
  LOOK_SEX,
  LOOK_SKIN,
  REGIONS,
  SEX_LABELS,
  regionOf,
} from "../../shared/anim/look.ts";
import { defaultPalette, EYE_BASE, EYE_COLORS, HAIR_BASE, HAIR_COLORS, SKIN_BASE, SKIN_TONES } from "../../shared/pack/palette.ts";

export const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => "&#" + c.charCodeAt(0) + ";");
export const button = (id: string, label: string, style = "secondary", attr = "") =>
  '<button type="button" data-action="' + esc(id) + '" class="' + style + '" ' + attr + ">" + esc(label) + "</button>";
export const field = (id: string, label: string, value = "", attr = "") =>
  "<label>" + esc(label) + '<input id="' + id + '" value="' + esc(value) + '" ' + attr + "></label>";
const palette = defaultPalette();
export function appearanceFields(look: Uint8Array, body: boolean): string {
  if (body)
    return REGIONS.map(
      (r, i) =>
        "<label>" +
        esc(r.label) +
        '<input type="range" data-region="' +
        i +
        '" min="-1" max="1" step=".05" value="' +
        regionOf(look, i) +
        '"></label>',
    ).join("");
  const styles = (id: number, label: string, items: readonly string[]) =>
    "<label>" +
    label +
    '<select data-look="' +
    id +
    '">' +
    items.map((name, i) => '<option value="' + i + '" ' + (look[id] === i ? "selected" : "") + ">" + esc(name) + "</option>").join("") +
    "</select></label>";
  const colors = (id: number, label: string, base: number, count: number) =>
    "<label>" +
    label +
    '</label><div class="swatches">' +
    Array.from({ length: count }, (_, i) => {
      const at = (base + i) * 4;
      return (
        '<button type="button" data-action="swatch" data-field="' +
        id +
        '" data-value="' +
        i +
        '" aria-label="' +
        label +
        " " +
        (i + 1) +
        '" aria-pressed="' +
        (look[id] === i) +
        '" style="--swatch:rgb(' +
        palette[at] +
        " " +
        palette[at + 1] +
        " " +
        palette[at + 2] +
        ')"></button>'
      );
    }).join("") +
    "</div>";
  return (
    styles(LOOK_SEX, "Body type", SEX_LABELS) +
    colors(LOOK_SKIN, "Skin tone", SKIN_BASE, SKIN_TONES) +
    styles(
      LOOK_HAIR,
      "Hair",
      HAIR_STYLES.map((s) => s.label),
    ) +
    colors(LOOK_HAIR_COLOR, "Hair color", HAIR_BASE, HAIR_COLORS) +
    (look[LOOK_SEX] === 0
      ? styles(
          LOOK_BEARD,
          "Beard",
          BEARD_STYLES.map((s) => s.label),
        )
      : "") +
    colors(LOOK_EYE_COLOR, "Eye color", EYE_BASE, EYE_COLORS)
  );
}
