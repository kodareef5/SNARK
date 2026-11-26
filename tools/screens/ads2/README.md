# SNARK screen library

Forty original ads and operating screens are ready for handoff in `var/ads2/out/`. Its `sheet.csv` supplies the names, screen types, channels, poster times and rights. The [visual proof](../../../var/ads2/work/screen-library.pdf) shows the final stills and frames from each encoded clip.

| Channel | Delivery | Art, copy and rebuild instructions |
| --- | --- | --- |
| Billboard ads | 20 stills, 1280 × 420 JPEG | [Illustrated roadside campaigns](billboards/README.md) |
| Billboard ads | 6 loops, 854 × 280 MP4, 7–9 seconds | [Animated roadside campaigns](loops/README.md) |
| TV spots | 6 commercials, 854 × 480 MP4, 14.50–15.71 seconds | [Commercials and shot sequences](tv/README.md) |
| Laptop screens | 8 stills, 1280 × 800 JPEG | [Programs and evidence plates](laptops/README.md) |

The built-in image generator made the original art. The production folders retain the exact prompts, copy and compositing programs. `var/ads2/work/` holds the selected source plates, shot intermediates and inspection sheets. Keep the plates with the project to reproduce the exact art. A fresh generation from the same prompt gives a new interpretation.

## Verify the handoff

Run these commands from the worktree root with Python 3, Pillow, FFmpeg and FFprobe.

```sh
python3 tools/screens/ads2/check.py
python3 tools/screens/ads2/proof.py
```

The checker compares the sheet to the files on disk, checks the delivery counts, metadata and dimensions, opens each image, verifies each clip's video stream, rate, duration, poster and MP4 atom order, and decodes every frame. The proof builder reads the final JPEGs and the decoded movie samples. It writes the review PDF under `var/ads2/work/`.

After rebuilding any of the four batches, use `python3 tools/screens/ads2/check.py --assemble` to validate all four sets of rows and replace the combined sheet. Each batch README gives its own render and review commands.

The delivered video uses 24 fps H.264, yuv420p and a front-loaded MP4 index. Every clip is silent. All twelve clips were designed and reviewed for slow motion or ordinary cuts with no rapid flashing. The loop checks also compare the encoded seam with neighboring frames.
