"""Redraws the concept's region pictures in the build's region-map colours.

    python3 recode.py

The briefs asked for red, yellow, green, cyan, blue and magenta for regions 0 to 5, white for the eye and grey for the
inside of the mouth. The build reads red, green, blue, cyan, magenta and yellow for regions 0 to 5, and black for
what is never dyed (tools/art/spec.ts). The background stays black too. Fails on any colour it does not know.
"""

import os

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
CONCEPT = os.path.join(os.path.dirname(HERE), "concept")

# Brief colour -> build colour.
RECODE = {
    (255, 0, 0): (255, 0, 0),  # 0 Body
    (255, 255, 0): (0, 255, 0),  # 1 Face
    (0, 255, 0): (0, 0, 255),  # 2 Beak
    (0, 255, 255): (0, 255, 255),  # 3 Forehead, Neck and Feet
    (0, 0, 255): (255, 0, 255),  # 4 Head
    (255, 0, 255): (255, 255, 0),  # 5 Wings and Patterning
    (255, 255, 255): (0, 0, 0),  # the eye: never dyed
    (128, 128, 128): (0, 0, 0),  # inside the mouth: never dyed
    (0, 0, 0): (0, 0, 0),  # claws and background
}

for view in ("side", "front", "back", "top"):
    src = np.asarray(Image.open(os.path.join(CONCEPT, f"regions_{view}.png")).convert("RGB"))
    out = np.zeros_like(src)
    done = np.zeros(src.shape[:2], bool)
    for a, b in RECODE.items():
        hit = np.all(src == a, axis=2)
        out[hit] = b
        done |= hit
    if not done.all():
        stray = {tuple(c) for c in src[~done].reshape(-1, 3)[:5]}
        raise SystemExit(f"regions_{view}.png: colours not in the brief's code, such as {stray}")
    Image.fromarray(out).save(os.path.join(HERE, f"{view}.png"))
    print(f"recode: {view}.png")
