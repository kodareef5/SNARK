# The sky's mood keys: first, the style sheet

You are the painter of a game's sky. You have the whole job: generation, any scripts you want, looking at the result and sending it back to yourself. Work only in this folder. Python 3 with Pillow, NumPy and SciPy is installed. Keep every picture the image tool gives you that you build on in `originals/`, and every prompt you used in `prompts.md`.

## What it is for

The game is a survival game in the manner of ARK: Survival Evolved, with art of its own: tropical islands, jungle, beaches, a calm sea, and the stone and timber bases players build. The engine draws its sky as cheaply as a sky can be drawn: one small table looked up per pixel, made at build time from a physical model of the atmosphere and then graded by a few numbers per hour (tint, saturation, horizon against zenith, glow toward the sun) to match eight paintings. Those eight paintings, the mood keys, are what "beautiful" means for this game's sky at every hour. The project's owner put it as: the sky needs to be smart, a cheap trick that runs fast, and beautiful.

The eight hours, by the sun's height above the horizon:

| Key | Sun | What it should feel like |
| --- | --- | --- |
| dawn | 2° up | the first light: cool and clean, a soft warm band low toward the sun, the land still in blue shade |
| morning | 15° | fresh, bright, a little cool, long shadows, dew-clear air |
| noon | 66° | the saturated tropical day: deep clear blue overhead, luminous sea-haze at the horizon, hard sun |
| afternoon | 35° | the same day grown warmer and hazier, the light starting to lean gold |
| golden hour | 8° | long, warm, honeyed light raking across everything; the hour players stop to look |
| sunset | 0° | the sun on the sea's rim: the sky on fire toward it, rose and violet away from it |
| dusk | 8° below | the afterglow: an ember line at the horizon, the zenith darkening to deep blue, the first stars |
| night | the moon high, opposite the sun | blue, readable, silvery: dark enough to be night, light enough to find your way |

A player who has played ARK should feel the saturated tropical day, the long warm golden hour and the blue readable night they remember, and it should be ours, not a copy.

## This first job: the style sheet

The final keys will each be painted over a render of the game's proving ground that another team is making now, 2:1 and 2,048 wide. Until it comes, work out the palette and the hand, as a map painter worked out a style sheet before painting a city. Make:

1. `style/sheet.png`: the eight hours as one colour script, in one picture so they share one hand: eight panels of the same view at the eight hours, in a grid, each a wide view of a tropical island coast like ours from a low headland, the sea to the horizon, jungle and a beach, a squared limestone wall of a survivor's base catching the light (the attached picture is one of our stone buildings, rendered plainly), and a grey card on the ground in the open. The sun's side of the sky in view, the sun or its glow placed at its height. A few thin clouds in each panel, to show how cloud takes the light at that hour.
2. `style/away.png`: the same eight hours looking away from the sun, where the sky does different things (the clear blue at noon, the rose band over the earth's blue shadow at sunset and dusk).
3. `style/STYLE.md`: the palette in numbers and the hand in words. For each hour, sRGB values read from your panels for: the sky near the zenith, 30° up away from the sun, the horizon toward the sun, the horizon away from it, the sun's light on the sunlit grey card and the shade on the shaded one, the lit and the shaded side of a cloud. Say how they relate across the day and what makes the set ours.
4. A larger painting of any panel you want to test the hand at full size is welcome in `style/`.

## The bar

- **One hand, one palette across the eight**: they read as one day on one island, a colour script for a film, not eight pictures from eight places.
- **Beautiful at a glance, and light that could be real.** The physical table will be graded to these colours, so paint what the sky can do: by day the sky is brightest toward the horizon and toward the sun and deepest blue overhead, never brighter at the zenith than at the horizon. The sun's light goes white-gold at noon, gold at 15°, amber at 8°, orange-red at the rim. The shade is lit by the sky, so it is blue, and bluer the lower the sun. At sunset and dusk the zenith darkens first and the horizon toward the sun keeps its warmth longest; away from the sun a band of rose rises over the blue-grey shadow of the earth. At night the sky is a deep blue, brighter toward the horizon and round the moon, the land readable in silver and blue-grey.
- **Values the engine holds.** Exposure is set per hour so that a grey card of sRGB 128 lying face up in the open shows about these sRGB levels, as the game shows it today: 59 at dawn, 91 in the morning, 123 at noon, 111 in the afternoon, 64 at the golden hour, 49 at sunset, 36 at dusk and 36 at night; and a card in shade about 35, 70, 70, 70, 55, 29, 21 and 21. At noon the sky 30° up, away from the sun, is about as bright as sRGB (150, 190, 230), whatever its hue. Paint the land and sky to that brightness, so the keys show the game as it will look.
- **Ours.** Not ARK's sky copied and not a photograph: a sky with its own character that a player would recognise as this game's. Say in STYLE.md what that character is.
- Not a cartoon and not a photograph: a colour key as a film's lighting artist paints one, true in its light, simplified in its forms, luminous.

Sky photographs and other games may be looked at for how light behaves; none is given to the image tool. The only pictures you start from are ours.

## Report

Finish with `REPORT.md`: what you made and how, what you measured, how many rounds it took, how long, and what you are not satisfied with. Say plainly where it falls short.
