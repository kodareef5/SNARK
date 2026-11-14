# Draws where things lie on each piece's picture, from the geometry in pieces.py, for whoever paints the picture.
#
#   python3 guides.py
#
# Writes tex/<picture>/guide/*.png and guide/LAYOUT.json. Every guide is 2048 pixels square, row 0 at the top, and
# covers exactly what the picture covers.

import json
import math
import os

import numpy as np
from PIL import Image

import pieces as P

HERE = os.path.dirname(os.path.abspath(__file__))
N = 2048


def save(folder, name, a, mode=None):
    os.makedirs(folder, exist_ok=True)
    if a.dtype == np.uint16:
        Image.fromarray(a).save(os.path.join(folder, name))
    else:
        Image.fromarray(a.astype(np.uint8), mode).save(os.path.join(folder, name))


def foot_line(clumps, xs, foot, tuft, jitter):
    """The foot of a tier as level 0 builds it: straight between its columns."""
    cols = clumps.columns(-P.H - P.SPAN, P.H + P.SPAN, 4)
    ys = [P.foot_y(clumps, x, foot, tuft, jitter) for x in cols]
    return np.interp(xs, cols, ys)


def profile(rows, ys):
    """The front's base depth and swell at heights ys, from a tier's rows."""
    yr = [r[0] for r in rows][::-1]
    return np.interp(ys, yr, [r[1] for r in rows][::-1]), np.interp(ys, yr, [r[2] for r in rows][::-1])


def bundle_colors(n, seed):
    """Neighbours far apart in hue: each next bundle turns the hue by the golden angle."""
    out = []
    for i in range(n):
        h = (seed * 0.17 + i * 0.381966) % 1.0
        r, g, b = (0.5 + 0.5 * math.cos(2 * math.pi * (h + k / 3)) for k in range(3))
        out.append((int(60 + 180 * r), int(60 + 180 * g), int(60 + 180 * b)))
    return out


def wall():
    folder = os.path.join(HERE, "tex", "thatch", "guide")
    xs = -P.H + (np.arange(N) + 0.5) / N * P.SPAN
    ys = P.WALL_V0 + (N - 1 - np.arange(N) + 0.5) / N * P.SPAN  # row 0 at the top
    X, Y = np.meshgrid(xs, ys)
    ur, _ = P.upper_rows(0)
    lr, _ = P.lower_rows(0)
    up_foot = foot_line(P.UPPER, xs, P.UPPER_FOOT, 0.13, 0.03)
    lo_foot = foot_line(P.LOWER, xs, P.LOWER_FOOT, 0.10, 0.03)
    up_tips, lo_tips = ur[-1][0], lr[-1][0]
    # Which tier is in front at each pixel, and its bundle.
    upper = Y >= up_foot[None, :]
    info = {}
    for name, cl in (("upper", P.UPPER), ("lower", P.LOWER)):
        idx = np.zeros(N, int)
        t = np.zeros(N)
        for c, x in enumerate(xs):
            idx[c], t[c] = cl.at(x)
        info[name] = (idx, t)
    ui, ut = info["upper"]
    li, lt = info["lower"]
    bundle = np.where(upper, ui[None, :], li[None, :])
    across = np.where(upper, ut[None, :], lt[None, :])
    # Zones.
    zone = np.zeros((N, N), np.uint8)
    zone[(~upper) & (Y >= lo_tips)] = 1  # lower body
    zone[(~upper) & (Y < lo_tips) & (Y >= lo_foot[None, :])] = 2  # lower tips
    zone[(~upper) & (Y < lo_foot[None, :])] = 3  # below the lower tips: nothing
    zone[upper & (Y >= up_tips)] = 4  # upper body
    zone[upper & (Y < up_tips)] = 5  # upper tips
    zone[Y > 2.985] = 6  # the cut top of the wall, under the ceiling
    colors = {0: (40, 40, 40), 1: (150, 120, 70), 2: (230, 210, 150), 3: (25, 25, 30), 4: (190, 150, 80), 5: (250, 235, 180), 6: (110, 90, 60)}
    layout = np.zeros((N, N, 3), np.uint8)
    for k, c in colors.items():
        layout[zone == k] = c
    # Bundle edges and the rods.
    edge = np.abs(np.diff(bundle, axis=1, prepend=bundle[:, :1])) > 0
    layout[edge] = (20, 20, 20)
    for y, w in ((P.UPPER_ROD, 0.025), (P.LOWER_ROD, 0.025)):
        layout[np.abs(Y - y) < w] = (110, 60, 30)
    save(folder, "layout.png", layout)
    # Each bundle its own colour.
    up_c = bundle_colors(P.UPPER.n, 1)
    lo_c = bundle_colors(P.LOWER.n, 2)
    bund = np.zeros((N, N, 3), np.uint8)
    for i, c in enumerate(up_c):
        bund[upper & (bundle == i)] = c
    for i, c in enumerate(lo_c):
        bund[(~upper) & (bundle == i)] = c
    bund[zone == 3] = 0
    save(folder, "bundles.png", bund)
    # Where stems may be: the envelope of the cut-out tips, white inside.
    inside = (zone != 3).astype(np.uint8) * 255
    save(folder, "envelope.png", inside)
    # How far along its stems each pixel is, from where the tier is tied (0) to its foot (1).
    up_top, lo_top = 2.985, 1.82
    along = np.where(upper, (up_top - Y) / (up_top - up_foot[None, :]), (lo_top - Y) / (lo_top - lo_foot[None, :]))
    save(folder, "along.png", np.clip(along * 255, 0, 255))
    # The front's depth, metres out from the middle of the wall, over 0.2 m.
    uz, usw = profile(ur, Y)
    lz, lsw = profile(lr, Y)
    full = np.where(upper, np.array(P.UPPER.full)[ui][None, :], np.array(P.LOWER.full)[li][None, :])
    bmp = np.sin(np.pi * np.clip(across, 0, 1)) ** 0.6
    pinch = np.vectorize(P.post_pinch)(X)
    z = np.where(upper, uz + usw * full * bmp, lz + lsw * full * bmp) * pinch
    tips = (zone == 2) | (zone == 5)
    flare = np.where(upper, 0.045, 0.035) * np.clip(along - 0.8, 0, 0.2) / 0.2
    z = z + np.where(tips, flare, 0)
    save(folder, "depth.png", (np.clip(z / 0.2, 0, 1) * 65535).astype(np.uint16))
    meta = {
        "covers": {"x": [-P.H, P.H], "y": [P.WALL_V0, P.WALL_V0 + P.SPAN], "metres_per_pixel": P.SPAN / N},
        "rows": "row 0 is the top of the picture; y is height above the foot of the wall",
        "zones": {"1": "lower tier body", "2": "lower tier tips (cut out)", "3": "below the lower tips: nothing", "4": "upper tier body", "5": "upper tier skirt tips (cut out)", "6": "cut top of the wall"},
        "upper_tier": {"tied_at": P.UPPER_ROD, "tips_start": up_tips, "bundles": P.UPPER.n, "bundle_edges_x": [round(e, 4) for e in P.UPPER.edges]},
        "lower_tier": {"tied_at": P.LOWER_ROD, "tips_start": lo_tips, "bundles": P.LOWER.n, "bundle_edges_x": [round(e, 4) for e in P.LOWER.edges]},
    }
    with open(os.path.join(folder, "LAYOUT.json"), "w") as f:
        json.dump(meta, f, indent=1)


def door():
    folder = os.path.join(HERE, "tex", "door", "guide")
    t = P.TILE["door"]
    us = (np.arange(N) + 0.5) / N
    vs = (N - 1 - np.arange(N) + 0.5) / N
    U, V = np.meshgrid(us, vs)
    layout = np.zeros((N, N, 3), np.uint8) + 30
    y = V * t - 0.3
    for front in (True, False):
        x = U * t - P.DOOR_W / 2 - 0.05 if front else P.DOOR_W / 2 + 1.55 - U * t
        inx = np.abs(x) <= P.DOOR_W / 2 - 0.02
        foot = foot_line(P.DOOR_REEDS, x[0], 0.03, 0.025, 0.01)
        iny = (y <= P.DOOR_H - 0.03) & (y >= foot[None, :])
        reeds = inx & iny
        idx = np.array([P.DOOR_REEDS.at(v)[0] for v in x[0]])
        cols = bundle_colors(P.DOOR_REEDS.n, 3)
        for i, c in enumerate(cols):
            layout[reeds & (idx[None, :] == i)] = c
        if front:
            frame = np.zeros_like(reeds)
            for s in (-1, 1):
                frame |= np.abs(x - s * P.D_STILE) < P.D_FRAME_R
            for yy in (0.11, 1.18, P.DOOR_H - 0.11):
                frame |= np.abs(y - yy) < P.D_FRAME_R
            a = np.array([-P.D_STILE + 0.04, 0.16])
            b = np.array([P.D_STILE - 0.05, P.DOOR_H - 0.17])
            d = (b - a) / np.linalg.norm(b - a)
            dist = np.abs((x - a[0]) * d[1] - (y - a[1]) * d[0])
            frame |= (dist < 0.024) & (y > 0.1) & (y < P.DOOR_H - 0.1)
            layout[frame & reeds] = (90, 50, 25)
    save(folder, "layout.png", layout)
    meta = {
        "covers": "3 m by 3 m, row 0 at the top",
        "outside_face": "u = (x + 0.75) / 3, v = (y + 0.3) / 3: x across the door from -0.7 (hinge side) to 0.7, y up from its foot, so the outside face is drawn on the left half as seen from outside",
        "inside_face": "u = (0.7 - x + 1.55) / 3, v as above: the inside face is drawn on the right half as seen from inside",
        "frame_on_outside": "stiles at x = +-%.3f, rails at y = 0.11, 1.18 and %.3f, brace from (%.2f, 0.16) to (%.2f, %.2f), all %.3f m thick poles lying on the reeds" % (P.D_STILE, P.DOOR_H - 0.11, -P.D_STILE + 0.04, P.D_STILE - 0.05, P.DOOR_H - 0.17, 2 * P.D_FRAME_R),
        "reeds": {"bundles": P.DOOR_REEDS.n, "edges_x": [round(e, 4) for e in P.DOOR_REEDS.edges], "top": P.DOOR_H - 0.03},
    }
    with open(os.path.join(folder, "LAYOUT.json"), "w") as f:
        json.dump(meta, f, indent=1)


if __name__ == "__main__":
    wall()
    door()
    print("guides: written")
