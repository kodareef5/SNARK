"""Paint the coastal field marks in model space so both sides and both wing poses agree."""

import numpy as np
from PIL import Image, ImageFilter
from scipy.ndimage import map_coordinates


def ramp(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def mix(a, b, mask):
    return a + (np.asarray(b, dtype=np.float32) - a) * mask[..., None]


def paint(fields, base, normal, occlusion, put):
    x, y, z, wing, horn, feet, eye, tongue = fields.transpose(2, 0, 1)
    span = abs(x)
    # Sample seamless pigment variation in animal space. Stretch the fine grain
    # along the bill and flight fingers to follow the direction of growth.
    grain = np.random.default_rng(7384).uniform(-1, 1, (47, 47, 47)).astype(np.float32)

    def noise(sx, sy, sz):
        return map_coordinates(grain, [span * sx, y * sy, z * sz], order=1, mode="grid-wrap")

    cloud = noise(13, 18, 14)
    fleck = noise(80, 133, 92)
    # A pale breast, a slate mantle and a slim nape stripe follow the trunk as it rises.
    back = np.interp(
        z,
        [-1, -0.55, -0.25, 0.02, 0.12, 0.22, 0.36, 0.47, 0.56, 0.75],
        [0.73, 0.775, 0.83, 0.85, 0.90, 1.03, 1.17, 1.285, 1.40, 1.5],
    )
    mantle = ramp(-0.018, 0.022, y - back + 0.015 * cloud) * (1 - ramp(0.44, 0.56, z))
    rgb = mix(np.array([215, 209, 191]), [75, 95, 108], mantle)
    marked = mantle.copy()

    # Matched upper and lower sails, pale at the root, with softly tipped outer fingers.
    tip = ramp(2.23, 3.43, span)
    sweep = z + 0.18 * span
    edge = ramp(-0.32, 0.15, sweep)
    sail = mix(np.array([151, 175, 176]), [98, 133, 151], ramp(0.32, 2.25, span))
    sail = mix(sail, [74, 99, 118], edge * 0.52)
    bars = np.exp(-(((span - 2.20 + 0.45 * sweep) / 0.10) ** 2)) + 0.65 * np.exp(
        -(((span - 2.59 + 0.45 * sweep) / 0.085) ** 2)
    )
    sail = mix(sail, [54, 77, 95], np.maximum(0.43 * bars, 0.85 * tip))
    # Narrow pale scallops break up the outer bars. They follow the finger rather than crossing the body.
    wash = np.exp(-(((span - 2.34 + 0.45 * sweep) / 0.077) ** 2)) + 0.68 * np.exp(
        -(((span - 2.73 + 0.45 * sweep) / 0.06) ** 2)
    )
    sail = mix(sail, [179, 193, 184], 0.35 * wash * (0.83 + 0.17 * cloud))
    sail += (cloud * 5 + fleck * 3)[:, :, None]
    rgb += (cloud * 6 + fleck * 5)[:, :, None]
    rgb = mix(rgb, sail, wing)
    rgb = mix(rgb, [163, 125, 91], feet * 0.84)

    # The bill grows out of a cream cheek. The orange crest has one dark band below its golden tip.
    bill = ramp(0.726, 0.745, z + 0.47 * (y - 1.392) + 0.007 * cloud) * horn
    crest = ramp(1.448, 1.468, y + 0.12 * (0.65 - z) + 0.004 * cloud) * horn
    tipband = ramp(1.635, 1.655, y) * (1 - ramp(1.691, 1.708, y)) * crest
    golden = ramp(1.67, 1.752, y)
    billcolor = mix(np.array([189, 121, 69]), [212, 156, 94], ramp(0.82, 1.45, z))
    billcolor += (noise(110, 140, 18) * 5 + cloud * 4)[:, :, None]
    rgb = mix(rgb, billcolor, bill)
    rgb = mix(rgb, mix(np.array([185, 111, 64]), [221, 162, 86], golden), crest)
    rgb = mix(rgb, [69, 85, 95], tipband)

    # Narrow the eye stripe toward the nape. Keep the brow above it ivory.
    line = 1.431 - 0.17 * (0.680 - z)
    stripe = (1 - ramp(0.013, 0.027, abs(y - line))) * ramp(0.39, 0.57, z) * (1 - ramp(0.667, 0.692, z)) * horn
    rgb = mix(rgb, [68, 83, 86], stripe)
    # The globe has its own UV island. The rounded iris, dark pupil and small
    # reflected sky spot are centred on its visible outer pole.
    er = np.hypot((z - 0.680) / 0.032, (y - 1.432) / 0.028)
    iris = mix(np.array([177, 148, 97]), [65, 57, 46], ramp(0.59, 1.02, er))
    iris = mix(iris, [31, 39, 40], 1 - ramp(0.53, 0.64, er))
    glint = 1 - ramp(0.003, 0.0068, np.hypot(z - 0.689, y - 1.440))
    iris = mix(iris, [248, 244, 219], glint)
    # The original rig exposes a narrow patch of globe. Carry the round iris onto
    # the adjacent lid so it reads as a single quiet eye at gameplay distance.
    orbit = np.hypot((z - 0.680) / 0.031, (y - 1.432) / 0.023)
    surround = (1 - ramp(1.03, 1.38, orbit)) * ramp(0.055, 0.085, span)
    rgb = mix(rgb, [152, 140, 110], surround)
    opening = (1 - ramp(0.81, 1.02, orbit)) * ramp(0.055, 0.085, span)
    rgb = mix(rgb, iris, np.maximum(eye, opening))
    eye = np.maximum(eye, opening)
    rgb = mix(rgb, [180, 130, 121], tongue)

    def full(field):
        return np.asarray(Image.fromarray(field.astype(np.float32)).resize(base.size, Image.Resampling.BILINEAR))

    # Keep fine hide variation. Suppress coarse baked shadows and the dark rings around the donor's eye.
    luma = np.asarray(base.convert("L"), np.float32)
    broad = np.asarray(base.convert("L").filter(ImageFilter.GaussianBlur(9)), np.float32)
    gain = np.clip((luma - broad) / 255, -0.38, 0.38) * full(0.28 + 0.14 * wing - 0.23 * eye)
    coat = np.stack([full(ch) for ch in rgb.transpose(2, 0, 1)], -1) * (1 + gain[..., None])
    put(Image.fromarray(np.uint8(np.clip(coat, 0, 255))), "base")

    relief = full(0.20 + 0.15 * wing - 0.13 * horn - 0.06 * eye)
    normal[:, :, :2] *= relief[:, :, None]
    normal[:, :, 2] = np.sqrt(np.maximum(0, 1 - (normal[:, :, :2] ** 2).sum(2)))
    put(Image.fromarray(np.uint8(np.clip(normal * 127.5 + 127.5, 0, 255))), "normal")
    ao = 255 - (255 - occlusion.astype(np.float32)) * (0.20 + 0.16 * full(wing))
    rough = full(194 - 95 * eye - 23 * np.maximum(bill, crest) + 11 * wing)
    put(Image.fromarray(np.uint8(np.stack((ao, rough, np.zeros_like(ao)), -1))), "packed", 512)

    # Put dye only on the corresponding field mark. Eyes and mouth keep their natural colour.
    pattern = np.maximum(marked * (1 - wing), stripe)
    pattern = np.maximum(pattern, wing * np.maximum(bars * 0.45, tip * 0.86))
    root = (1 - ramp(0.4, 1.28, span)) * wing
    dye = np.stack(
        (
            0.39 * pattern,
            0.37 * root,
            0.46 * np.maximum(bill, crest) * (1 - tipband),
            0.55 * tipband,
            0.48 * wing * (1 - root) * (1 - tip * 0.7),
            0.39 * (1 - wing) * (1 - np.maximum(bill, crest)) * (1 - pattern) * (1 - feet),
        ),
        -1,
    )
    dye *= (1 - np.maximum(eye, tongue))[:, :, None]
    dye /= np.maximum(1, dye.sum(2, keepdims=True))
    # Average the six weights before quantization. Filtering six byte channels
    # separately with a ringing filter can overshoot at a chart boundary.
    small = np.stack(
        [
            np.asarray(Image.fromarray(ch.astype(np.float32)).resize((512, 512), Image.Resampling.BOX))
            for ch in dye.transpose(2, 0, 1)
        ],
        -1,
    )
    quantized = np.uint8(np.clip(small, 0, 1) * 255)
    put(Image.fromarray(quantized[:, :, :3]), "mask")
    put(Image.fromarray(quantized[:, :, 3:]), "mask2")
