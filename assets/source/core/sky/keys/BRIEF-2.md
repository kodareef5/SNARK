# The sky's mood keys: the eight keys

Read `BRIEF.md` again: what the keys are for and the bar are unchanged. Your style sheet (`style/`) is the start, and this round paints the real keys.

## What the style sheet got right, and must keep

- One place and one hand across the eight: it reads as one day on one island. "Limestone, lagoon, ember" is a character of our own.
- Noon: a deep mineral blue overhead over a pearl haze at the sea line, the hard tropical day players remember.
- The golden hour's honeyed wall, the sunset's copper rim against violet, and a night that is blue and readable with silver on the stone.
- Values by the ground cards, which you calibrated.

## Where it falls short

1. **Dawn is gloomy.** Its zenith is a heavy slate blue (54, 78, 123) and the whole sky reads as an evening under cloud. Dawn should be the cleanest light of the day: a pale, cool, luminous sky, deepest overhead in a clear blue, a band of pearl and peach low toward the sun, and the land still in blue shade under it.
2. **Dusk is night with an ember line.** At 8° below the horizon the sky still holds a great deal of light over a dark land: it is the brightest thing in the scene. Toward the set sun a broad afterglow runs from ember at the sea line up through gold and a pale green-blue into deep blue; away from it the rose band sits over the earth's blue shadow. The zenith is a deep, clear blue, much brighter than at night. Dusk and night must not be the same navy.
3. **The golden hour's glow is narrow.** The warm sky toward the sun is a thin band under a sky as blue as the afternoon's. At 8° the whole quarter of the sky round the sun is warm and luminous, honey into apricot, and the sky above turns a softer, warmer blue.
4. **The sunset's zenith is too purple** for light that could be real. A violet is welcome low and away from the sun; overhead the sky stays a dusky blue.

## This round: paint the eight keys

`base/` now holds the pictures to paint over, made by the team building the sky table: `dawn.png` to `night.png`, each a full panorama, 2,048 by 1,024, equirectangular (the middle column faces heading 345, north is 0, clockwise; `base/points.json` gives the formula), from 4 m over the proving ground's west rim, so all the land lies below the horizon and the sea runs to a clean sea line. The land is drawn as the game draws it today, lit from the key's own light; the sky is a flat colour, so the sky is all yours.

`underlay/` holds the same pictures with a physical sky in place of the flat one, made by `physical.py` (ours): air, haze and ozone scattering light from the key's sun, exposed as the engine exposes it. `underlay/points.json` gives its colours at every point, including the three grey faces under physical light. It is what physics does at each hour: where the sky is brightest, how the colours run from the sun to the opposite horizon, the earth's shadow rising at dusk. It is not the look: at dawn, sunset and dusk it is pale and washed out, as a sky exposed for the ground is. Paint the mood the style sheet found, keeping the relations the underlay shows.

Make `dawn.png`, `morning.png`, `noon.png`, `afternoon.png`, `golden.png`, `sunset.png`, `dusk.png` and `night.png` in this folder, each 2,048 by 1,024 RGB, and:

- **Keep the land exactly where it is.** The horizon, the sea line, every slope's outline and the cubes stay on their pixels, because the points are read off them and the table's horizon must meet the land. Relight the land for the hour as a lighting artist would (the colour of the sun on lit slopes, the sky's blue in shade, the sea taking the sky's colour) without adding to it: no new trees, no jungle, no buildings; the game's checker may stay. The land is not the subject.
- **The panorama closes:** its left edge continues its right edge with no seam, and the sky near the top is painted as the projection stretches it (the zenith row is one point).
- **The sun and the moon where `points.json` puts them**, at their size: the sun's disc is about 1.2° across and the moon's 1.5° (about 7 and 9 pixels tall; wider than tall near the top of the panorama, as the projection draws them), with the glow round them. The moon stands opposite the sun, so it rises in the east at sunset and dusk; at night it is 66.7° up in the north. Stars at dusk and night: small, sparse, a few brighter.
- **Thin cloud only, and none on the points.** A few wisps or a thin streak where they help the mood, nowhere within 4° of the zenith, high, toward and away points.
- **The grey cubes and card lit as the painted light would light them.** The script reads the sunlit face, the shaded face and the card lying flat. The card must read within 3 levels of the brightness the game holds it to (`lowPolyUp` in `underlay/points.json`), and its colour, and the two faces', must be what the sky you painted and its sun would give. The underlay's values are physics; yours may be warmer or bluer where the sky is.
- **Light that could be real.** `measure.py` (ours) reads every key at the points and fits the kind of grade the sky table can make to the physical sky: a tint, a saturation, a lift of the horizon against the zenith and a glow toward the sun. The table will be held within 6 (OKLab × 100) of your key at each point after its grade, so `afterBestGrade` over 6 means the key asks for light the table cannot make. Run it (`python3 -I measure.py`) and get every key to 6 or under without giving up the mood; say in the report where you had to choose.

Write your own script that reads the points (each the mean of the 13 by 13 pixel square at the point's x and y) and writes `points.json` beside the keys with each key's seven colours. Show the eight keys together in `keys-sheet.png` (small, in a grid), and for each key two views as a player sees them, reprojected from the panorama into an ordinary 16:9 view 100° across, looking 10° up toward the light and away from it, in `views/` as JPEG. Judge the keys in those views as much as in the panoramas.

Keep the image tool's pictures you build on in `originals/`, prompts in `prompts.md`, and your scripts in `scripts/`. Finish by adding to `REPORT.md`: how the keys were made, the points read, the measure's numbers, how many rounds, how long, and where it falls short.
