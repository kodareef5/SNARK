import { catamaranWreck } from "../power_cats/spec.ts";

const form = catamaranWreck("manta", "sunk");
export default {
  ...form,
  materials: {
    ...form.materials,
    teak: {
      base: "tex/teak_base.png",
      packed: "tex/teak_packed.png",
      regions: { mask: "tex/teak_mask.png" },
      normal: "../power_cats/tex/teak_normal.png",
      height: "../power_cats/tex/teak_height.png",
      tiles: 2.4,
    },
  },
};
