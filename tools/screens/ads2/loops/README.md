# Animated roadside ads

Each film starts with one original panoramic plate from the built-in image generation tool. The six entries in [prompts.json](prompts.json) give the exact prompts. The selected PNGs live under `var/ads2/work/loops/` with the same names as the entries. The renderer sets all lettering with the local URW Base 35 fonts.

| Film | Seconds | Poster | How the film works |
| --- | ---: | ---: | --- |
| Backstep Parcel Express | 7 | 2 | A masked red feathered courier runs across the original paper and snaps back twice. A faded second impression briefly marks the server's previous position. The parcel service counts both trips toward its mileage. |
| Slipfax Portraits | 8 | 4 | A bowed dodo sits for a hand-tinted studio portrait. A second photographic exposure drifts out of register and back into it. The desync package includes both poses. |
| Dozehaven Motor Court | 9 | 5 | An allosaurus peers into a desert motel. Two windows go dark in succession, and the painted rooftop sign changes from vacancy to no vacancy. The new owners get the wake-up call. |
| Lid & Louver | 9 | 1 | Three fitted banks of Venetian blinds descend in sequence over Miami's three Tide Eyes. Window mullions, hanging cloth and the customer stay in front of the slats. |
| Underlot Lift Co. | 8 | 4 | A brass elevator needle swings from the ground floor down to minus four beside a trike and its operator. Light travels across the gilded door jambs. The ground floor depends on the terrain loading. |
| Plumbfin Bait Works | 8 | 3 | A weighted mesh swings a submerged supply crate from the boat as smaller waves refract the shark and the water around it. A megalodon takes an interest in the bait. |

## Rebuild

Run from the repository root with Python 3, Pillow, NumPy, FFmpeg with libx264, FFprobe and URW Base 35 OpenType installed. To regenerate a source plate, submit its prompt as a new opaque image to the built-in image generator and save its PNG to `var/ads2/work/loops/<name>.png`. The original six plates measure 2172 × 724. The masks and registration points in the renderer fit those exact compositions.

```sh
python3 tools/screens/ads2/loops/render.py --proof
python3 tools/screens/ads2/loops/render.py
PYTHONDONTWRITEBYTECODE=1 python3 tools/screens/ads2/loops/verify.py
```

The first command writes three layout samples per film under the working directory. The second encodes the six final MP4s in `var/ads2/out/` and writes their import rows to `var/ads2/work/loops/rows.csv`. Pass one or more prompt names to the renderer to rebuild selected films. Each cycle samples the interval from zero up to one, with the end pose supplied by the next playback of frame zero.

The verifier checks the source poses at both ends of the cycle, the encoded frame count, the single silent H.264 stream, 854 × 280 pixels, 24 fps, yuv420p, fast start, and the peak rolling one-second bitrate across the loop boundary. It also compares decoded frames for motion and seam continuity. It writes a four-frame visual inspection sheet for each film and the measured results to `var/ads2/work/loops/verification.csv`.
