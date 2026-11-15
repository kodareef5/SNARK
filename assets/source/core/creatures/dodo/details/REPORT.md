# Dodo loose feathers

Delivered five paired textures: `contour`, `contour_plain`, `down`, `flight`, and `tail`, each with its matching `_regions.png`. All ten are 1024 × 1024, 8-bit RGBA PNGs. Quills point down. Every feather occupies 896 pixels vertically (87.5% of the card), with 64 completely transparent pixels above and below. This satisfies the 6% minimum margin while approaching the requested 90% height.

| Feather | Shape and marking | Dyed regions | Clear margins: left / top / right / bottom |
| --- | --- | --- | --- |
| `contour` | Rounded back feather, downy root, cream crown tipping | 0 body + 5 cream | 252 / 64 / 252 / 64 px |
| `contour_plain` | Broader breast feather with a fluffier lower third | 0 body | 182 / 64 / 182 / 64 px |
| `down` | Loose hood tuft with branching fluff and a short quill | 4 hood | 110 / 64 / 110 / 64 px |
| `flight` | Long rounded finger, asymmetric vane, firmer barb structure | 5 cream | 330 / 64 / 330 / 64 px |
| `tail` | Broad curved vane, curling crown, two narrow cream bands | 0 body + 5 cream | 265 / 64 / 266 / 64 px |

Each exposed quill uses black in the region map, keeping its pale neutral color. The shaft inside the vane takes that part's dye and retains a subtle painted highlight.

## Making the assets

I inspected `three_quarter.png` and the neighboring body feather studies for the rounded shapes and soft flowing barbs. I used the **built-in image-generation tool** for five individual transparent painted masters. The down feather received a second image-tool pass to shorten its shaft and replace its closed vane with a looser tuft. The masters, including the initial down study, are retained in `sources/`. Exact prompts and source provenance are in `generation_prompts.json`.

`build_feathers.py` performs the reproducible texture preparation using Pillow, NumPy, and SciPy. It removes isolated background alpha specks while retaining the faint fringe attached to the feather, restores fully opaque coverage inside the vane, and fits the image proportionally into the padded square. It converts the paint to exact neutral grayscale, centers its opaque midtone near 232/255, reduces broad illumination, and retains fine barb contrast. Resizing uses premultiplied color internally; the delivered PNGs use straight alpha. Hidden RGB extends the neighboring feather color to avoid black filtering fringes.

The cream markings exist only in the region maps. The contour has curved terminal tipping. The tail has two separated curved bands, approximately 28 and 30 source pixels wide through their central sections. Small irregularities in their boundaries follow the painted texture. Region RGB contains only exact red, magenta, yellow, or black; no blended region IDs. Region alpha is byte-for-byte identical to base alpha. Region colors extend under transparent padding for filtering safety.

Rebuild everything from the retained masters with:

```sh
python3 build_feathers.py
```

This requires Pillow, NumPy, and SciPy; it does not call an image API.

## Checks and previews

The build checks dimensions, grayscale equality, zero-alpha margins, opaque vane coverage, partial-alpha fringes, exact region codes, matching alpha, and the two-region limit. `validation.json` records bounds, coverage counts, grayscale percentiles, and master hashes. The exported PNGs were also reopened and checked independently with `python3 check_exports.py`; all checks passed, including one contour tip marking and two separate tail bands.

- `preview.png` contains all five default-dyed feathers at **1024, 128, and 32 pixels**, on both mid grey `#808080` and sand `#c9b48a`. The 1024 cards are placed at 1:1. Open the sheet at 100% zoom to judge the stated sizes.
- `preview_game.png` is a compact native-size sheet at 128, 32, 8, and 4 pixels, plus rotated, flattened, and mirrored examples. These flat examples approximate card projection; they are not an engine render.
- `preview_alternate_dyes.png` shows all six combinations of the three additional body dyes and two additional cream dyes supplied in the brief. The hood dye stays at its default.

I inspected the full sheet and both compact sheets. At 128 pixels the five silhouettes, shafts, and fluff treatments remain distinct. At 32 pixels the contour tipping and two tail bands remain visible; the finer barbs merge into the soft edge. The alternate dyes retain clean separation without residual blue or cream hue. There is no ground plane, cast shadow, or rectangular matte baked into the textures.

## Limits and next adjustments

The previews use unlit channel-wise RGB multiplication by the supplied dye hex values, followed by alpha compositing. Engine lighting, color-space handling, region decoding, texture compression, and mip generation have not been exercised here.

At 4–8 pixels these become small flecks, with little internal structure. Cream flight feathers remain pale; the umber hood tuft and darker body dyes naturally make darker flecks. I would preserve those dye identities and use more cream-bearing feathers in a burst if pale distant visibility is essential. The dark plain breast feather is the weakest contrast against mid grey. In-engine validation should judge that combination before changing its albedo.

The files normalize image occupancy, not physical feather size. The hood tuft should spawn smaller than the contour feather, with wing and tail feathers larger. The next useful art pass is a lit, compressed 128px import seen tumbling and resting beside the dodo. No additional texture edits are needed for the supplied file contract.
