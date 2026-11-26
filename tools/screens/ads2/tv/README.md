# Television commercials

Six silent commercials use 18 final image plates and original, separately typeset advertising copy. Each spot runs at 24 frames per second. Its end card holds for roughly five seconds.

| Film | How the spot was made |
| --- | --- |
| Plume Ledger Estate Portraits | Two hand-tinted real-estate photographs dissolve at the chimney. An edited version of the first plate keeps the mailbox, path and trike in place while the house vanishes. A folding-camera insert and a mounted family print sell the studio's service. |
| Second Bell Recall Whistle | A field-guide gouache introduces the handler and her raptor. A close view of a brass whistle cuts to a doorstep full of respondents. Green felt, gold rules and a Bookman wordmark finish the pitch. |
| Strata Supper Club | A shopper falls through a painted sidewalk. The camera travels downward to the dining room, then pushes in on an inverted skyline cast in wafer. The final plum-and-gold menu card reserves seats by last known coordinates. |
| Tickaway Motor Tours | A Florida postcard and a guide's gesture establish the route. The first postcard repeats from precisely the same position after the bus rubber-bands. A parking meter supplies the punch line and the return ticket carries the fare. |
| Fussbudget Imprint Assortment | A test-kitchen painting gives way to a close product photograph of the sampler. A second kitchen scene matches the baby rex's markings, bow tie and powder-blue case. The leash gets its own line on the pack shot. |
| Velvet Rope Appeals | Three silver-gelatin scenes take the viewer from a wet pavement to the clerk's bell to the empty interview chair. A typewritten application reveals the sign-in requirement beside the locked-out applicant. |

## Rebuild

Run these commands from the worktree root. The renderer uses Python 3, Pillow, the freely distributed URW Base 35 OpenType fonts, FFmpeg with libx264 and FFprobe.

```sh
python3 tools/screens/ads2/tv/render.py
python3 tools/screens/ads2/tv/render.py --check
```

A campaign slug at the end of either command selects one film. The optional `--proof` mode renders each shot as a still for copy fitting. Finished films appear under `var/ads2/out/`. The renderer also writes the six import rows to `var/ads2/work/tv/rows.csv`.

The original built-in imagegen source PNGs live in `var/ads2/work/tv/art/`. To generate a fresh interpretation, take `base` from `prompts.json` and append one entry from the campaign's ordered `shots` array. Send the combined string to imagegen with an opaque background. Save each image as `<campaign>-1.png`, `-2.png` or `-3.png` in the art directory. For the two continuity edits, use the exact prompt and ordered reference filenames in `continuity.json`. Save each edited plate with the entry's name and a PNG extension. The renderer uses the edited fourth plates in the finished films. The retained originals reproduce the exact delivered cuts.

The `CUTS` table in `render.py` controls each picture aperture, focal point, camera move, shot duration and transition. Each campaign has its own typesetting function. FFmpeg moves the picture behind the stationary supersampled type, joins the shots, converts to limited-range BT.709 and encodes a single H.264 video stream with the MP4 index first.

Every encode checks dimensions, codec, pixel format, frame count, frame rate, duration, stream count, bitrate and atom order. The renderer extracts a full-size PNG from the middle of each shot and assembles a review sheet beside the per-film FFprobe report in `var/ads2/work/tv/<campaign>/`. The six final review sheets cover all 25 shots.
