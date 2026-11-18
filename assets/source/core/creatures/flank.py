"""Project the unlit Grab3D flank onto the authored skin atlas, in game metres."""
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.ndimage import distance_transform_edt, map_coordinates


def fade(a, b, x):
    t = np.clip((x-a)/(b-a), 0, 1)
    return t*t*(3-2*t)


def flank_base(folder, points, base):
    """Input and output albedo are sRGB [0, 1]. Keep existing dye masks and relief."""
    folder = Path(folder)
    source = np.asarray(Image.open(folder / "ref/donor-flank.png").convert("RGBA"), np.float32)/255
    x, y, z = np.moveaxis(points, -1, 0)
    if folder.name == "trike":
        # Bind the donor's hip and shoulder to the two leg roots. Lift the
        # donor's higher back progressively above its belly.
        along = np.interp(z, [-3, -1.53, .55, 1.18], [-2.85, -.72, 1.43, 1.81])
        up = y + np.interp(y, [.55, 1.45, 2.45], [0, .21, .56])
        area = fade(-3,-2.4,z)*(1-fade(.75,1.22,z))
    else:
        along = np.interp(z, [-3.6, -.80, 1.05, 1.68], [-2.85, .37, 2.28, 2.66])
        up = y + np.interp(y, [.45, 1.48, 2.92], [.02,.20,.11])
        area = fade(-3.6,-2.8,z)*(1-fade(1.0,1.6,z))
    # Keep the ventral seam, crest attachments and inside legs in the
    # native pigment. Limit the projection to matching lateral anatomy.
    area *= fade(.28,.68,abs(x))*fade(.55,1.05,y)
    h, w = source.shape[:2]
    coords = [(3.35-up)*(h/3)-.5, (along+3)*(w/6)-.5]
    rgb = np.stack([map_coordinates(source[...,k], coords, order=1, mode="nearest") for k in range(3)], -1)
    # Fade around the donor's belly and limb silhouette where their outlines
    # diverge. A hard alpha cutoff prints the donor's outline onto the flank.
    interior = distance_transform_edt(source[...,3] > .98).astype(np.float32)
    alpha = map_coordinates(fade(1,48,interior), coords, order=1, mode="constant")
    # The native base is already exposed for its colour regions. Carry over
    # the donor's scale contrast and muted pigment without doubling the dye.
    luma = rgb[...,0]*.2126 + rgb[...,1]*.7152 + rgb[...,2]*.0722
    detail = np.clip((luma/.36)**.82, .46, 1.40)
    chroma = np.clip((rgb+.04)/(luma[...,None]+.04), .78, 1.19)
    factor = detail[...,None]*chroma
    weight = (.9*area*alpha)[...,None]
    return np.clip(base*(1+weight*(factor-1)),0,1)
