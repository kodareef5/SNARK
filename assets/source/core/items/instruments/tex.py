"""Paint the instrument trim atlases from seeded materials and metric dial artwork."""

from math import pi, tau
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from surfaces import ATLASES, SIZE

DEST = Path(__file__).resolve().parent / "tex"


def noise(rng, side, across, along):
    spectrum = np.fft.rfft2(rng.standard_normal((side, side)))
    x = np.fft.rfftfreq(side)[None, :]
    y = np.fft.fftfreq(side)[:, None]
    filtered = spectrum * np.exp(-2 * pi ** 2 * ((x * across) ** 2 + (y * along) ** 2))
    field = np.fft.irfft2(filtered, s=(side, side), axes=(0, 1))
    return field / field.std()


def scratches(rng, metric_x, metric_y, count, *, slant, length, width):
    marks = np.zeros_like(metric_x)
    for _ in range(count):
        cx = rng.uniform(metric_x.min(), metric_x.max())
        cy = rng.uniform(metric_y.min(), metric_y.max())
        angle = rng.normal(slant, 0.18)
        major = (metric_x - cx) * np.cos(angle) + (metric_y - cy) * np.sin(angle)
        minor = (metric_x - cx) * -np.sin(angle) + (metric_y - cy) * np.cos(angle)
        body = np.exp(-0.5 * (minor / width) ** 2) * np.maximum(0, 1 - np.abs(major) / rng.uniform(*length))
        marks = np.maximum(marks, body * rng.uniform(0.28, 1.0))
    return marks


def brush(side, span, base, relief):
    color = Image.fromarray(np.uint8(np.clip(base, 0, 255)))
    cut = Image.new("L", (side, side))
    color_pen, relief_pen = ImageDraw.Draw(color), ImageDraw.Draw(cut)

    def point(position):
        x, y = position
        return ((0.5 + x / span) * side, (0.5 - y / span) * side)

    def polygon(outline, color, depth=0):
        pixels = list(map(point, outline))
        color_pen.polygon(pixels, fill=color)
        if depth:
            relief_pen.polygon(pixels, fill=depth)

    def line(path, color, width, depth=0):
        pixels = list(map(point, path))
        px = max(1, round(side * width / span))
        color_pen.line(pixels, fill=color, width=px, joint="curve")
        if depth:
            relief_pen.line(pixels, fill=depth, width=px, joint="curve")

    def result():
        return np.asarray(color, dtype=float), relief - 0.45 * np.asarray(cut) / 255

    return polygon, line, result


def optic_art(name, side, span, base, relief):
    polygon, line, result = brush(side, span, base, relief)
    if name == "dial":
        for index in range(48):
            angle = index * tau / 48
            radial = np.array([np.sin(angle), 1.12 * np.cos(angle)])
            reach = 0.008 if index % 12 == 0 else 0.0045 if index % 4 == 0 else 0.002
            line((radial * (0.044 - reach), radial * 0.044), (61, 54, 43), 0.0016 if index % 4 == 0 else 0.0008)
        polygon(((-0.010, -0.002), (0.010, -0.002), (0, 0.035)), (174, 54, 42))
        polygon(((-0.010, 0.002), (0.010, 0.002), (0, -0.033)), (50, 46, 37))
        polygon(((-0.004, 0.003), (0, 0.005), (0.004, 0.003), (0.004, -0.003),
                 (0, -0.005), (-0.004, -0.003)), (147, 111, 65))
    elif name == "receiver":
        polygon(((-0.017, 0.032), (0.017, 0.032), (0.017, 0.047), (-0.017, 0.047)), (38, 47, 32), 100)
        polygon(((-0.014, 0.035), (0.014, 0.035), (0.014, 0.044), (-0.014, 0.044)), (153, 164, 82))
        for x in (-0.009, -0.004, 0.001, 0.006):
            line(((x, 0.036), (x, 0.041 + x * 0.18)), (77, 95, 50), 0.0018)
        for index in range(7):
            y = 0.021 - index * 0.009
            line(((-0.022, y), (-0.015, y), (-0.011, y - 0.0015), (0.022, y - 0.0015)),
                 (24, 27, 26), 0.0044, 160)
            line(((-0.021, y + 0.0022), (0.021, y + 0.0014)), (107, 105, 96), 0.0010)
        line(((-0.018, -0.044), (0.018, -0.044)), (94, 96, 81), 0.0014)
    elif name == "navigator":
        for index in range(-3, 4):
            g = index * 0.013
            line(((g, -0.044), (g, 0.044)), (106, 146, 124), 0.00075)
            line(((-0.044, g), (0.044, g)), (106, 146, 124), 0.00075)
        polygon(((-0.044, 0.001), (-0.026, 0.009), (-0.022, 0.024), (-0.010, 0.030),
                 (-0.006, 0.044), (-0.044, 0.044)), (113, 152, 134))
        polygon(((0.044, -0.004), (0.022, -0.010), (0.021, -0.022), (0.034, -0.032),
                 (0.028, -0.044), (0.044, -0.044)), (109, 144, 129))
        line(((-0.036, -0.031), (-0.016, -0.013), (0.006, -0.017), (0.018, 0.009), (0.034, 0.024)),
             (38, 75, 62), 0.0033)
        polygon(((0.026, 0.033), (0.038, 0.023), (0.024, 0.016)), (44, 70, 52))
        line(((-0.034, 0.034), (-0.034, 0.029), (-0.028, 0.029)), (48, 89, 69), 0.0014)
        line(((0.025, -0.035), (0.037, -0.035)), (57, 87, 68), 0.0010)
    else:
        center = np.array([0.002, 0.004])
        diamond = [center + point for point in ((-0.007, 0), (0, 0.008), (0.007, 0), (0, -0.008), (-0.007, 0))]
        line(diamond, (42, 39, 37), 0.0018, 205)
        line(((-0.052, 0.004), diamond[0]), (47, 44, 41), 0.0018, 185)
        line((diamond[2], (0.039, 0.004)), (47, 44, 41), 0.0018, 185)
        line(((-0.050, 0.0019), (-0.006, 0.0019)), (115, 106, 92), 0.00065)
    return result()


def finish(name, side, span, color, seed):
    rng = np.random.default_rng(seed)
    y, x = np.mgrid[:side, :side]
    x = (x + 0.5 - side / 2) * span / side
    y = (y + 0.5 - side / 2) * span / side
    fine = noise(rng, side, 1.0, 1.35)
    broad = noise(rng, side, 15, 20)
    base = np.broadcast_to(np.asarray(color, dtype=float), (side, side, 3)).copy()
    tone = 2.8 * broad + 2.5 * fine
    relief = 0.09 * broad + 0.08 * fine
    rough, metal = 0.64, 0.0

    if name == "wood":
        wandering = 0.45 * noise(rng, side, 10, 60)
        grain = np.sin(tau * (x * 88 + wandering * 0.28))
        splits = np.maximum(0, grain) ** 10 * np.clip(0.55 + 0.4 * broad, 0, 1)
        fibers = noise(rng, side, 1.8, 39)
        tone += 7.5 * grain + 8.5 * fibers - 17 * splits
        relief += 0.14 * fibers - 0.44 * splits
        rough = 0.57 + 0.09 * splits
    elif name == "hide":
        pores = np.maximum(0, -fine - 0.8) ** 1.8
        creases = np.maximum(0, noise(rng, side, 10, 3) - 0.9) ** 1.4
        tone += 5.2 * broad - 6 * creases - 2.7 * pores
        relief += 0.13 * noise(rng, side, 2.3, 3.5) - 0.21 * pores - 0.14 * creases
        rough = 0.74 + 0.05 * pores
    elif name == "flax":
        twist = np.sin(tau * (112 * x + 235 * y + 0.26 * broad))
        strand = np.maximum(0, twist) ** 2
        tone += 15 * strand + 5 * fine
        relief += 0.38 * strand
        rough = 0.82 + 0.05 * fine
    elif name in ("stone", "stamp"):
        chips = np.maximum(0, broad - 0.25) * np.maximum(0, noise(rng, side, 4, 3) - 0.4)
        pits = np.maximum(0, -fine - 0.9) ** 1.5
        tone += 5.9 * broad + 9 * chips - 8 * pits
        relief += 0.22 * noise(rng, side, 1.5, 2.2) - 0.36 * pits
        rough = 0.8 + 0.08 * pits
    elif name in ("bronze", "iron", "amber", "rubber"):
        wear = scratches(rng, x, y, 28, slant=0.9, length=(0.004, 0.032), width=0.00063)
        flecks = np.maximum(0, fine - 0.85) ** 1.7
        tone += 27 * wear + 4 * flecks
        relief += -0.16 * wear - 0.12 * flecks
        if name == "bronze":
            rust = np.maximum(0, broad - 0.35)
            base += rust[..., None] * (-11, -7, 1)
            rough, metal = 0.37 + 0.12 * rust - 0.11 * wear, 0.83 - 0.15 * rust
        elif name == "iron":
            rough, metal = 0.55 - 0.16 * wear, 0.45 + 0.32 * wear
        elif name == "amber":
            rough = 0.54 + 0.11 * wear
        else:
            ribbing = np.maximum(0, np.sin(tau * (y * 115 + broad * 0.018))) ** 6
            tone += 4 * ribbing
            relief += 0.18 * ribbing
            rough = 0.82 - 0.1 * wear
    elif name in ("spy_lens", "hand_lens"):
        radius = np.sqrt(x * x + y * y)
        r = 0.046 if name == "spy_lens" else 0.059
        edge = np.exp(-((radius - r * 0.88) / (r * 0.13)) ** 2)
        tint = np.clip(0.5 + (x - y) / r, 0, 1)
        tone = 8 * tint + 0.8 * fine - 8 * np.clip(radius / r, 0, 1)
        base += edge[..., None] * np.array([9, 27, 22])
        base += ((1 - tint) * edge)[..., None] * np.array([-6, -12, -3])
        rough, relief = 0.16, 0.013 * broad
    elif name in ("dial", "receiver", "navigator"):
        tone = 1.9 * fine + 3.4 * broad
        rough = 0.46 if name == "dial" else 0.31
        relief = 0.05 * fine
    else:
        tone *= 0.20
        relief *= 0.20

    base += tone[..., None]
    if name in ("dial", "receiver", "navigator", "stamp"):
        base, relief = optic_art(name, side, span, base, relief)
    ao = 1 - 0.17 * np.clip(-relief, 0, 1)
    orm = np.stack([ao, np.broadcast_to(rough, ao.shape), np.broadcast_to(metal, ao.shape)], axis=-1)
    return base, relief, orm


def image(values):
    return Image.fromarray(np.uint8(np.rint(np.clip(values, 0, 255))))


def write_atlas(name, cells, span, finishes, seed):
    base = np.empty((SIZE, SIZE, 3))
    height = np.empty((SIZE, SIZE))
    orm = np.empty((SIZE, SIZE, 3))
    bounds = [round(index * SIZE / cells) for index in range(cells + 1)]
    for index, (surface, (column, row, color)) in enumerate(finishes.items()):
        x0, x1 = bounds[column:column + 2]
        y0, y1 = bounds[cells - row - 1:cells - row + 1]
        side = max(x1 - x0, y1 - y0)
        trim = np.s_[:y1 - y0, :x1 - x0]
        color_map, relief, packed = finish(surface, side, span, color, seed + index)
        base[y0:y1, x0:x1] = color_map[trim]
        height[y0:y1, x0:x1] = relief[trim]
        orm[y0:y1, x0:x1] = packed[trim]

    height = np.clip(height, -1.4, 1.35)
    dy, dx = np.gradient(height)
    normal = np.stack((-dx, dy, np.ones_like(dx)), axis=-1)
    normal /= np.linalg.norm(normal, axis=-1, keepdims=True)
    image(base).save(DEST / f"{name}_base.png", optimize=True)
    image((normal + 1) * 127.5).save(DEST / f"{name}_normal.png", optimize=True)
    image(height * 78 + 123).save(DEST / f"{name}_height.png", optimize=True)
    image(orm * 255).resize((SIZE // 2, SIZE // 2), Image.Resampling.BOX).save(DEST / f"{name}_orm.png", optimize=True)


if __name__ == "__main__":
    DEST.mkdir(exist_ok=True)
    for index, (name, (cells, span, finishes)) in enumerate(ATLASES.items()):
        write_atlas(name, cells, span, finishes, 53021 + index * 100)
