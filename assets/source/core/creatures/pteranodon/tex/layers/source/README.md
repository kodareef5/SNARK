# Original sources

`marks.json` is the original placement and timing drawing, in metres in the current
position maps' frame (X is negative on the stored side). Dimensions are full
millimetres. `palette.json` holds unlit sRGB pigments. All brushes are original
analytic drawing in `../paint.py`; there are no generated images, borrowed game
images, or external raster dependencies and therefore no image-generation prompts.

The current accepted base and height drawing supplies the fuzz/skin grain. Membrane
marks use the same X/Z field on both faces. Positions, pieces, physical texel sizes,
flow, base, height, normal, region/weight maps and the vein network are reread at
each execution. Sources and outputs are hashed in `../checks/manifest.json`.
