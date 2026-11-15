# The moon's face

You are painting the moon of a game's sky, and you have the whole job: generation, any scripts, looking at the result at the size a player sees it and sending it back to yourself until it is excellent. Work only in this folder. Python 3 with Pillow, NumPy and SciPy is installed; the machine is shared, so keep scripts light. Keep every picture the image tool gives you that you build on in `originals/`, and every prompt you used in `prompts.md`.

## What it is for

The game is a survival game in the manner of ARK: Survival Evolved, with art of its own. Its world is our own Earth long after people: tropical coasts, jungle, drowned cities. At night the sky is a deep, readable blue, and the moon stands opposite the sun and lights the land. The engine draws it as a disc 1.5° across, which is 30 to 60 pixels on a player's screen, tinted by the moon's light of the moment and faded by the air near the horizon. It is small, but it is the one thing a player looks at on purpose at night.

## The bar

- **Read at a glance** as the Moon: at 40 pixels, the face everyone knows, its dark seas and bright highlands in the places they are, with one or two bright rayed craters; at 512, a painting that rewards a close look.
- **Ours, and not a photograph.** Painted in the hand of a game whose sky is luminous and a little more saturated than life: a moon you would paint, not a moon you would photograph.
- **Calm.** Nothing so dark or busy that the disc looks dirty or blotched at a small size; the full moon is evenly bright to its rim.

## What the engine needs

`moon.png`: 512 by 512, RGBA, sRGB colour. The disc fills the square, edge to edge, with alpha outside it and a clean anti-aliased rim. A full face: no shadow line, no darkening toward the rim, no glow or halo, no light painted in from any side; the shader adds whatever light and phase it wants. Colour may lean a little warm or cool, but keep it close to grey, since the shader tints it; say its mean colour.

## Check

Show it as it will be seen: the disc shrunk to 32, 48 and 64 pixels on a deep night blue, and at full size, side by side in `check.png`. Judge it there.

Moon photographs may be looked at for where its features lie; none is given to the image tool.

## Deliver

`moon.png`, the scripts that made it from `originals/`, `check.png`, and `REPORT.md`: how it was made, its mean colour, how many rounds it took, how long, and what you are not satisfied with.
