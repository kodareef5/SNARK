"""The supply capsule's trim atlas: eight strips, 2048 pixels long and 256 tall, at 1,024 pixels a metre.

A strip is 2 m of a course 0.25 m tall. It is painted by the Miami instruments' painter (../tide-eye/paint.py), whose
strips are 32 m of a course 4 m tall at 64 pixels a metre: the same hand sixteen times nearer, so what is a rivet as
broad as a fist up there is a machine screw here, a plate 8 m long is one of half a metre, and a weep two metres long
is one of a hand's breadth. Its weathering comes from the instruments' flat-lit scans (../tide-eye/tex/scan-*.png).

The strips, in the order kit.py names them: porcelain, cast bronze, dark steel, optical glass (which takes the tier's
colour), scorched steel, the brass register, the vented underplate, and salt-weathered porcelain. The fifth is the
capsule's own: the nozzle bells and the skirt above them, heat-tinted from straw at the cool end through brown, purple
and blue to soot at the lip.
"""

import sys
from pathlib import Path
import numpy as np

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE.parent / "tide-eye"))
import paint as eye  # noqa: E402

from paint import BAND, S, SCAN, TOP, V, W, clamp, cloud, field, grain, joints, over, smooth, stain, strip, studs, weeps  # noqa: E402

# Dull steel, straw, brown, purple, blue, soot: where each begins down the strip, and its colour.
TEMPER = [(0.0, (104, 108, 114)), (0.2, (188, 162, 98)), (0.42, (152, 98, 60)), (0.58, (112, 72, 122)), (0.76, (66, 98, 172)), (1.0, (40, 38, 40))]


def scorch(seed):
    """Steel that has been hot: heat-tinted in bands down the strip, the hottest at its foot, welded every half metre,
    with soot drawn down it and a row of screws along its cool edge."""
    s = strip()
    plate = field(SCAN["steel"], seed)
    fine = grain(plate)
    # How hot it has been, which wanders along the strip so no band is a ruled line.
    heat = clamp((V - TOP) / BAND + 0.07 * cloud(seed + 1, 260, 400) + 0.025 * cloud(seed + 2, 40, 60))
    tint = np.zeros((S, W, 3), np.float32)
    for (a, ca), (b, cb) in zip(TEMPER, TEMPER[1:]):
        t = smooth(heat, a, b)[..., None]
        inside = ((heat >= a) & (heat <= b))[..., None]
        tint = np.where(inside, np.asarray(ca, np.float32) * (1 - t) + np.asarray(cb, np.float32) * t, tint)
    dome, ring = studs(64, (TOP + 16,), 3.4, seed % 23)
    seam = joints([384, 896, 1408, 1920], 1.6)
    bead = joints([384, 896, 1408, 1920], 5.0)
    r = np.random.default_rng(seed)
    soot = weeps(seed + 3, [(r.random() * W, TOP + BAND * (0.35 + 0.5 * r.random()), 0.4 + 0.6 * r.random()) for _ in range(40)], 3.0, 90, 0.06)
    # The oxide is a film on the metal: the plate's own light and dark show through it.
    base = tint * (0.78 + 0.22 * (plate / np.maximum(plate.mean((0, 1)), 1)).mean(-1, keepdims=True))
    base = over(base, 0.7 * soot, (30, 28, 30))
    base = over(base, 0.5 * dome, (150, 150, 152))
    base = stain(base, 0.6 * ring + 0.55 * seam, (0.4, 0.38, 0.38))
    s["base"] = base
    s["height"] = 0.5 + 0.18 * dome - 0.05 * ring + 0.08 * bead - 0.2 * seam + 0.03 * fine - 0.015 * soot
    s["ao"] = clamp(1 - 0.5 * ring - 0.5 * seam)
    s["rough"] = clamp(0.34 + 0.1 * cloud(seed + 4, 90, 90) + 0.22 * smooth(heat, 0.75, 1.0) + 0.3 * soot + 0.2 * seam, 0.16, 0.95)
    s["metal"] = clamp(0.92 - 0.55 * soot - 0.3 * smooth(heat, 0.85, 1.0))
    return s


def main():
    eye.OUT = HERE / "tex"
    eye.OUT.mkdir(exist_ok=True)
    # The scans are the instruments'.
    scan_dir = HERE.parent / "tide-eye" / "tex"
    quarters = eye.quarters
    eye.quarters = lambda name: quarters(name) if (HERE / "tex" / name).exists() else _from(scan_dir, name, quarters)
    eye.scans()
    capsule = [
        eye.ceramic(211, [224, 736, 1248, 1760], (230, 224, 204), 0.3),
        eye.bronze(221),
        eye.steel(231),
        eye.glass(241),
        scorch(251),
        eye.brass(261),
        eye.vents(271),
        eye.ceramic(281, [96, 608, 1120, 1632], (214, 205, 182), 1.0),
    ]
    eye.write("", eye.atlas(capsule), regions=True)


def _from(folder, name, quarters):
    """The painter reads its scans from its own tex folder: read them from the instruments' for this one call."""
    out = eye.OUT
    eye.OUT = folder
    try:
        return quarters(name)
    finally:
        eye.OUT = out


if __name__ == "__main__":
    main()
