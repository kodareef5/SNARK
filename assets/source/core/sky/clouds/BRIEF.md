# The cloud layers

You are making the clouds of a game's sky, and you have the whole job: generation, every script, looking at the result lit and sending it back to yourself until it is excellent. Work only in this folder. Python 3 with Pillow, NumPy and SciPy is installed; the machine is shared, so keep scripts light. Keep every picture the image tool gives you that you build on in `originals/`, and every prompt you used in `prompts.md`.

## What it is for

The game is a survival game in the manner of ARK: Survival Evolved, with art of its own: tropical islands, jungle, beaches, a calm sea. Its sky is drawn as cheaply as a sky can be: a small table looked up per pixel for the air, and two layers of cloud, each one picture on a plane high over the map, scrolled slowly by the wind and lit by the shader in the sun's colour of the moment: white at noon, orange at sunset, grey-blue under the moon. These clouds are over every player all day on medium graphics and up, and they are most of what a player looks at when they look up.

- **The low layer: broken heaped cloud.** The fair-weather cumulus of the trade winds over tropical islands: scattered and clustered heaps with blue between, some in loose rows along the wind, big ones and small ones and the shreds that come off them.
- **The high layer: thin streaks.** Cirrus far above: fibres, hooks and mare's tails drawn out by the wind, thin veils, here and there a patch of fine ripples; mostly empty sky.

## The bar

- **It reads as weather, not as a picture.** Shapes at several scales: groups of clouds, single clouds, the heaped lobes inside a cloud, the shreds at its edge. Soft edges with structure inside, not a soft blob and not a cut-out.
- **No repeat a player notices across the whole dome,** from straight overhead down to 10° above the horizon, where the layers are seen edge on and squeezed. Nothing in a tile so distinctive that the eye finds it again a tile away.
- **Believable from overhead and at the horizon,** lit at noon, at sunset and under the moon.
- **At home over tropical islands like ARK's, and ours.** The sky a player remembers from the game: deep blue with bright heaped cloud drifting over, not overcast and not a storm.

## What the engine needs

For each layer one square picture, `low.png` and `high.png`, 2,048 pixels a side, 8 bits, RGB:

- **red is cover**: how much of the sky behind the cloud it hides, 0 to 1;
- **green is thickness**: how little sunlight gets through, 0 to 1, where 1 is the darkest heart of the thickest heap the layer holds;
- blue unused, 0.

Both are linear values, not sRGB, and hold no light at all: no lit side, no shadow, no rim. The shader puts the light in from the sun's direction of the moment, so a picture with light painted in would be lit twice and wrong half the day. Each picture tiles both ways: across its edge it must not jump harder than inside it (the measure in `light.py`, the game's own, must be under 2 across and down, and nearer 1 is better). The engine makes the mips by halving.

One low tile spans 8 km and one high tile 16 km. The lighting script puts the low layer at 1,500 m and the high one at 8,000 m: overhead, a screen of 102° shows about 3.7 km of the low layer, so a trade cumulus of 300 m to 1.5 km is 80 to 400 pixels of the picture; at 10° above the horizon the low layer is 8.6 km off and the high one 45 km, so the dome down to 10° holds about two low tiles across and six high ones.

## How it is judged

`light.py` here lights the layers as the game's shader is planned to and draws them over the dome: the whole dome from below, and views of 102° toward the sun, away from it and straight up, at noon, at sunset and under the moon, with the engine's mips. Run it (`python3 -I light.py --out lit`) and look at what it draws. Judge your layers by those pictures, not by the raw picture: that is how they will be judged. If you find the lighting itself wrong, say how and why in the report; do not change it to flatter the clouds. It also writes `tiled.jpg` (each layer's cover tiled 3 by 3) and `seams.txt`.

## Examples

For craft, the best materials made so far: `../../../../../planning/artist-test/` (start with `wood/checks/layers.jpg` and `feather/qa/layers_contact.png`, then their reports) and the stone masonry in `../../structures/stone/tex/masonry/`, whose `FEEDBACK-*.md` files show what was sent back and why. Each is a complete set with its own build and checks.

Sky photographs may be looked at for how cloud is shaped; none is given to the image tool.

One thought, not a method: seen from straight above with the sun straight above and nothing under it but a black sea, a cloud is brighter where it is thicker and has no lit side. The image tool returns pictures of about 1,254 pixels whatever is asked; reaching 2,048 with real detail and a seamless wrap is part of the job.

## Deliver

`low.png`, `high.png`, the scripts that build them from `originals/`, `lit/` from `light.py` for your final pair, and `REPORT.md`: how each file was made, what you measured (seams, mean cover, how the cover and thickness are spread, that no light direction is in them), which way the high layer's streaks lie, how many rounds it took, how long, and what you are not satisfied with. Say plainly where it falls short.
