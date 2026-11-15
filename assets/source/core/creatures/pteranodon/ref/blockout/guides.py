"""Finishes the block-out guides preview.py --guides renders: each on the concept's ground colour, with its silhouette
as a mask beside it (white on black), and one contact sheet.

    python3 guides.py DIR
"""

import glob
import os
import sys

import numpy as np
from PIL import Image

BG = (214, 212, 206)


def main():
    folder = sys.argv[1]
    for path in sorted(glob.glob(os.path.join(folder, "guide_*.png"))):
        if path.endswith("_mask.png"):
            continue
        im = Image.open(path).convert("RGBA")
        alpha = np.asarray(im)[:, :, 3]
        Image.fromarray(np.where(alpha > 127, 255, 0).astype(np.uint8)).save(path[:-4] + "_mask.png")
        bg = Image.new("RGBA", im.size, BG + (255,))
        bg.alpha_composite(im)
        bg.convert("RGB").save(path)
    print("guides: finished", folder)


if __name__ == "__main__":
    main()
