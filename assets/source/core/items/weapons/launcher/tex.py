"""Paint the launcher's two materials, each one trim sheet of bands (bands.py).

    python3 tex.py

Writes tex/metal_*.png and tex/furniture_*.png (base, normal, orm), 512 pixels, the same on every run. Every band
repeats along the picture, and up it inside its own rows, so a tube wrapped in one shows no seam. NumPy and Pillow.
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.dont_write_bytecode = True
from bands import CHEVRON, FURNITURE, METAL, PAD, SIDE, TURN, rows

rng = np.random.default_rng(713)


def noise(tall, along, up):
    """Noise that wraps both ways, smeared `along` pixels along the picture and `up` it: mean 0, deviation 1."""
    spectrum = np.fft.rfft2(rng.standard_normal((tall, SIDE)))
    ky = np.fft.fftfreq(tall)[:, None]
    kx = np.fft.rfftfreq(SIDE)[None, :]
    out = np.fft.irfft2(spectrum * np.exp(-2 * np.pi ** 2 * ((ky * up) ** 2 + (kx * along) ** 2)), s=(tall, SIDE))
    return (out - out.mean()) / out.std()


def step(lo, hi, x):
    t = np.clip((x - lo) / (hi - lo), 0, 1)
    return t * t * (3 - 2 * t)


def scratches(tall, count, longest):
    """Fine scratches, most along the picture and a few across: 1 where one runs."""
    out = np.zeros((tall, SIDE))
    for _ in range(count):
        length = int(rng.integers(12, longest))
        lean = rng.normal(0, 0.08) if rng.random() < 0.8 else rng.normal(0, 1.2)
        x, y = rng.integers(0, SIDE), rng.integers(0, tall)
        depth = rng.uniform(0.35, 1.0)
        for k in range(length):
            fade = np.sin(np.pi * (k + 0.5) / length)
            out[int(round(y + lean * k)) % tall, (x + k) % SIDE] = max(out[int(round(y + lean * k)) % tall, (x + k) % SIDE], depth * fade)
    return out


def layers(tall, colour, rough, metal):
    """A band's maps, flat: base colour (sRGB of 255), occlusion, roughness, metalness, height."""
    return {"base": np.ones((tall, SIDE, 3)) * np.asarray(colour, float), "ao": np.ones((tall, SIDE)), "rough": np.full((tall, SIDE), rough),
            "metal": np.full((tall, SIDE), metal), "height": np.zeros((tall, SIDE))}


STEEL = np.array([130.0, 121.0, 106.0])
# Steel a chip in the paint lays bare: gone dark, a little brown.
CHIPPED = np.array([74.0, 68.0, 60.0])


def painted(tall, colour, chips, scuffs):
    """Paint over steel: faded and dusty in patches, chipped to the metal in specks, scuffed along its length."""
    m = layers(tall, colour, 0.6, 0.0)
    fade = noise(tall, 70, 46)
    grain = noise(tall, 1.1, 1.1)
    drag = noise(tall, 38, 1.2)
    # The slow fading is slight: a face drawn flat takes the palette colour nearest its own patch, and a patch much
    # darker than the paint would take a grey.
    m["base"] *= (1 + 0.035 * fade + 0.03 * grain + 0.03 * drag)[:, :, None]
    # Dust lies where the paint has faded: a little paler and warmer.
    dust = step(0.5, 1.8, fade)[:, :, None]
    m["base"] = m["base"] * (1 - 0.12 * dust) + np.array([150.0, 140.0, 112.0]) * 0.12 * dust
    scuff = scratches(tall, scuffs, 150)
    m["base"] *= (1 + 0.32 * scuff)[:, :, None]
    # Chips cluster: specks of a fine noise, let through where a slow one is high.
    speck = noise(tall, 1.9, 1.5) + chips * 0.6 * noise(tall, 26, 18)
    chip = np.clip(step(2.45, 2.7, speck) + step(0.86, 0.97, scuff), 0, 1)
    # Round a chip the paint is rubbed thin and pale before it gives way.
    thin = step(1.8, 2.45, speck) * (1 - chip)
    m["base"] *= (1 + 0.3 * thin)[:, :, None]
    m["base"] = m["base"] * (1 - chip[:, :, None]) + CHIPPED * (1 + 0.08 * grain)[:, :, None] * chip[:, :, None]
    m["rough"] += 0.05 * fade + 0.1 * scuff - 0.1 * chip
    # The game mirrors its sky in a metal, and bare steel would be blue with it: the firearms' steel is as dull as this.
    m["metal"] = 0.2 * chip
    m["height"] = 0.1 * grain - 0.5 * scuff - 1.4 * chip
    m["ao"] = 1 - 0.25 * chip
    return m


def steel(tall, colour, rough, metal, brushing, wear, open):
    """
    Steel brushed along the picture, rubbed paler in patches. `open` is its occlusion: the game lights a dark face with
    its sky, which turns it blue, and occlusion is what holds that light off.
    """
    m = layers(tall, colour, rough, metal)
    m["ao"][:] = open
    streak = 0.75 * noise(tall, 90, 0.8) + 0.25 * noise(tall, 20, 1.5)
    slow = noise(tall, 60, 30)
    m["base"] *= (1 + brushing * (0.07 * streak + 0.03 * slow))[:, :, None]
    rubbed = step(0.9, 2.0, slow + 0.4 * streak)[:, :, None] * wear
    m["base"] = m["base"] * (1 - rubbed) + STEEL * rubbed
    scuff = scratches(tall, 6 + tall // 6, 90)
    m["base"] *= (1 + 0.2 * scuff)[:, :, None]
    m["rough"] += brushing * 0.06 * streak - 0.12 * rubbed[:, :, 0]
    m["height"] = brushing * 0.25 * streak - 0.3 * scuff
    return m


def hazard(tall):
    """Yellow and black chevrons leaning along the picture, CHEVRON pixels from one to the next."""
    m = painted(tall, (212, 168, 40), 0.5, 4)
    y, x = np.mgrid[0:tall, 0:SIDE]
    black = step(0.44, 0.56, np.abs(((x + 2 * y) % CHEVRON) / CHEVRON - 0.5) * 2)[:, :, None]
    m["base"] = m["base"] * (1 - black) + np.array([26.0, 26.0, 27.0]) * black * (m["base"].mean(axis=2, keepdims=True) / 150)
    return m


def soot(tall):
    m = layers(tall, (21, 21, 22), 0.96, 0.0)
    m["base"] *= (1 + 0.12 * noise(tall, 30, 2))[:, :, None]
    # The game casts no shadow into a bore. Its occlusion is what keeps the sky's light out of it.
    m["ao"][:] = 0.12
    return m


def wrap(tall):
    """
    Glass tape wound round the tube, one turn TURN pixels along the picture, leaning so that a turn begun at the band's
    foot ends at its top one turn on: wrapped once round, the winding meets itself. Each turn laps over the last.
    """
    m = layers(tall, (142, 120, 86), 0.92, 0.0)
    y, x = np.mgrid[0:tall, 0:SIDE]
    across = ((x - TURN * y / tall) % TURN) / TURN
    # The weave: threads 4 pixels apart both ways, which the band's height and the picture's width both hold whole.
    weave = np.sin(2 * np.pi * x / 4) * np.sin(2 * np.pi * y / 4)
    lap = 1 - step(0.0, 0.14, across)
    edge = step(0.86, 1.0, across)
    slow = noise(tall, 50, 40)
    scorch = step(0.4, 1.9, noise(tall, 70, 30))
    stain = noise(tall, 6, 9)
    # Each turn its own shade, as tape off one roll is not: the turn's number, wrapped, picks it.
    turn = np.floor((x - TURN * y / tall) / TURN).astype(int) % (SIDE // TURN)
    own = rng.normal(0, 0.05, SIDE // TURN)[turn]
    shade = 1 + 0.05 * weave + 0.06 * slow + 0.035 * stain - 0.3 * lap + 0.07 * edge + own
    m["base"] *= shade[:, :, None]
    m["base"] = m["base"] * (1 - 0.45 * scorch[:, :, None]) + np.array([62.0, 50.0, 40.0]) * 0.45 * scorch[:, :, None]
    m["ao"] = 1 - 0.45 * lap
    m["rough"] += 0.03 * weave - 0.05 * scorch
    m["height"] = 1.6 * across + 0.2 * weave - 0.8 * lap
    return m


def polymer(tall):
    """Stippled black polymer, greyed where hands have polished it."""
    m = layers(tall, (38, 36, 33), 0.84, 0.0)
    # Held off the sky's light, as the dark steel is.
    m["ao"][:] = 0.7
    stipple = noise(tall, 1.3, 1.3)
    slow = noise(tall, 40, 30)
    polished = step(0.6, 1.8, slow)
    m["base"] *= (1 + 0.05 * stipple + 0.05 * slow + 0.16 * polished)[:, :, None]
    m["rough"] += 0.05 * stipple - 0.2 * polished
    m["height"] = 0.9 * stipple * (1 - 0.6 * polished)
    return m


def rubber(tall):
    """Dull rubber in ribs across the picture, 8 pixels from one to the next."""
    m = layers(tall, (36, 32, 27), 0.93, 0.0)
    x = np.arange(SIDE)[None, :] * np.ones((tall, 1))
    rib = np.cos(2 * np.pi * x / 8)
    dusty = noise(tall, 30, 12)
    m["base"] *= (1 + 0.14 * rib + 0.08 * dusty)[:, :, None]
    m["ao"] = 0.6 + 0.2 * (rib * 0.5 + 0.5)
    m["height"] = 1.3 * rib
    return m


def glass(tall):
    """A coated lens: dark, bluer toward the band's top, glossy."""
    m = layers(tall, (16, 34, 44), 0.07, 0.0)
    up = (1 - np.arange(tall)[:, None] / (tall - 1)) * np.ones((1, SIDE))
    m["base"] = m["base"] * (1 - up[:, :, None]) + np.array([40.0, 96.0, 112.0]) * up[:, :, None]
    m["base"] *= (1 + 0.04 * noise(tall, 12, 3))[:, :, None]
    return m


PAINTERS = {
    "paint": lambda tall: painted(tall, (88, 96, 62), 1.0, 46),
    "warhead": lambda tall: painted(tall, (58, 76, 56), 0.7, 10),
    "dark": lambda tall: steel(tall, (60, 56, 51), 0.74, 0.2, 1.0, 0.14, 0.7),
    "bare": lambda tall: steel(tall, (152, 141, 122), 0.6, 0.15, 1.4, 0.0, 0.85),
    "yellow": lambda tall: painted(tall, (212, 168, 40), 0.5, 3),
    "hazard": hazard,
    "soot": soot,
    "wrap": wrap,
    "polymer": polymer,
    "rubber": rubber,
    "glass": glass,
}
# How steeply each band's height leans its normals.
RELIEF = {"wrap": 0.55, "rubber": 0.6, "polymer": 0.45}


def sheet(name, bands):
    base = np.zeros((SIDE, SIDE, 3))
    orm = np.zeros((SIDE, SIDE, 3))
    normal = np.zeros((SIDE, SIDE, 3))
    for band, _ in bands:
        top, bottom = rows(bands, band)
        tall = bottom - top - 2 * PAD
        m = PAINTERS[band](tall)
        # The normal from the height, green up the picture, the band wrapping onto itself.
        dx = (np.roll(m["height"], -1, 1) - np.roll(m["height"], 1, 1)) / 2
        dy = (np.roll(m["height"], 1, 0) - np.roll(m["height"], -1, 0)) / 2
        lean = RELIEF.get(band, 0.35)
        n = np.dstack((-dx * lean, -dy * lean, np.ones_like(dx)))
        n /= np.linalg.norm(n, axis=2, keepdims=True)
        packed = np.dstack((m["ao"], np.clip(m["rough"], 0.04, 1), np.clip(m["metal"], 0, 1)))
        # The pads carry the band on round itself.
        lines = np.arange(-PAD, tall + PAD) % tall
        base[top:bottom] = m["base"][lines]
        orm[top:bottom] = packed[lines] * 255
        normal[top:bottom] = n[lines] * 127.5 + 127.5
    out = Path(__file__).parent / "tex"
    out.mkdir(exist_ok=True)
    for layer, picture in (("base", base), ("normal", normal), ("orm", orm)):
        Image.fromarray(np.clip(np.rint(picture), 0, 255).astype(np.uint8), "RGB").save(out / f"{name}_{layer}.png", optimize=True)


sheet("metal", METAL)
sheet("furniture", FURNITURE)
