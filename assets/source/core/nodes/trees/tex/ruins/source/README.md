The five `*_generated.png` files are unchanged native outputs from the built-in image generation tool. They are the complete frozen inputs for an offline rebuild.

| File | Native pixels | Contents |
| --- | --- | --- |
| column_generated.png | 1254 x 1254 | Upper and lower column sections, left and right |
| pole_generated.png | 1254 x 1254 | Upper and lower unrolled concrete pole |
| post_generated.png | 1254 x 1254 | Upper and lower unrolled corroded pipe |
| sign_generated.png | 1254 x 1254 | Front above, back below |
| car_generated.png | 971 x 1619 | Continuous car body unwrap |

`prompts.json` contains the exact four initial generation prompts. `car_prompt.txt` contains the exact car prompt. Only the car generation used an image input: `car_layout_reference.png`, a direct crop of the supplied `guide/layout.png` at (1280,768,2048,2048). The other sources were generated from words after inspecting the repository's original concept paintings and palette. No external image, game imagery, web reference, or downloaded asset was used.

`assembled_master.png` is the reproducible 2048 x 2048 composition BEFORE material classification, surface relief, and final colour finishing. The builder recreates it; it is not an additional input. The column capital is registered to the first 273 rows. Tall sources overlap for 128 rows during composition; wrap joins use adjacent source samples with a smooth transition in a narrow corridor. Original source pictures retain all their native pixels.

Source SHA-256 values and the exact physical island scales are recorded in `../checks/construction.json`. Image generation is not called during rebuilding, and no generated image needs to be retrieved from the tool's automatic storage.

`srgb.icc` is a locally generated standard sRGB ICC profile, frozen to prevent its creation timestamp from changing rebuilt PNG bytes. Only the base colour and assembled colour master embed it.
