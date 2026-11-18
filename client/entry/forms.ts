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
const steps = ["Identity", "Appearance", "Build", "Spawn"];
export function stepper(index: number) {
  return (
    '<ol class="steps" aria-label="Character creation">' +
    steps
      .map(
        (name, i) =>
          "<li " + (i === index ? 'aria-current="step"' : "") + ' class="' + (i < index ? "done" : "") + '">' + (i + 1) + ". " + name + "</li>",
      )
      .join("") +
    "</ol>"
  );
}
function styles(look: Uint8Array, id: number, label: string, items: readonly string[]) {
  return (
    "<fieldset><legend>" +
    label +
    '</legend><div class="chips">' +
    items
      .map((s, i) => button("style", s, "chip", 'data-field="' + id + '" data-value="' + i + '" aria-pressed="' + (look[id] === i) + '"'))
      .join("") +
    "</div></fieldset>"
  );
}
function colors(look: Uint8Array, id: number, label: string, base: number, count: number) {
  return (
    "<fieldset><legend>" +
    label +
    '</legend><div class="swatches">' +
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
    "</div></fieldset>"
  );
}
export function identityFields(look: Uint8Array, name: string) {
  return (
    field("name", "Survivor name", name, 'maxlength="24" autocomplete="off" placeholder="Choose a name"') +
    styles(look, LOOK_SEX, "Body type", SEX_LABELS)
  );
}
export function appearanceFields(look: Uint8Array) {
  return (
    colors(look, LOOK_SKIN, "Skin tone", SKIN_BASE, SKIN_TONES) +
    styles(
      look,
      LOOK_HAIR,
      "Hair",
      HAIR_STYLES.map((s) => s.label),
    ) +
    colors(look, LOOK_HAIR_COLOR, "Hair color", HAIR_BASE, HAIR_COLORS) +
    (look[LOOK_SEX] === 0
      ? styles(
          look,
          LOOK_BEARD,
          "Beard",
          BEARD_STYLES.map((s) => s.label),
        )
      : "") +
    colors(look, LOOK_EYE_COLOR, "Eye color", EYE_BASE, EYE_COLORS)
  );
}
const groups = [
  { name: "Torso", ids: [21, 16, 17, 18, 19, 20, 6, 7] },
  { name: "Head", ids: [0, 1, 2, 3, 4, 5] },
  { name: "Arms", ids: [8, 9, 10, 11] },
  { name: "Legs", ids: [12, 13, 14, 15] },
];
export function bodyFields(look: Uint8Array, group: number) {
  return (
    '<div class="chips" role="group" aria-label="Body regions">' +
    groups.map((g, i) => button("group", g.name, "chip", 'data-index="' + i + '" aria-pressed="' + (group === i) + '"')).join("") +
    '</div><div class="sliders">' +
    groups[group]!.ids.map(
      (i) =>
        "<label>" +
        esc(REGIONS[i]!.label) +
        '<input type="range" data-region="' +
        i +
        '" min="-1" max="1" step=".05" value="' +
        regionOf(look, i) +
        '"></label>',
    ).join("") +
    "</div>"
  );
}
