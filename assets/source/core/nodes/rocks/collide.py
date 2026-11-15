# The boxes a rock is bumped into, stood on and struck by: a few upright boxes
# fitted to the solid's height over the ground, so that what a player sees and
# what stops them agree. A box runs from below the ground up to its own height.
# Fitted greedily: each box added is the rectangle and height that most reduce
# how far the boxes' top lies from the rock's, cell by cell, over the rock and
# round it, and boxes stop being added when one would gain little.

import numpy as np

CELL = 0.05
FLOOR = -0.3


def heights(solid, lo, hi):
    """The rock's top over a grid of CELL: the highest point inside it over each cell, 0 where it does not rise above the ground."""
    xs = np.arange(lo[0], hi[0] + CELL, CELL, dtype=np.float32)
    ys = np.arange(lo[1], hi[1] + CELL, CELL, dtype=np.float32)
    zs = np.arange(0.0, hi[2] + CELL, CELL, dtype=np.float32)
    X, Y = np.meshgrid(xs, ys, indexing="ij")
    top = np.zeros(X.shape, np.float32)
    for z in zs:
        p = np.stack([X.ravel(), Y.ravel(), np.full(X.size, z, np.float32)], axis=1)
        inside = (solid(p) < 0).reshape(X.shape)
        top = np.where(inside, z, top)
    return xs, ys, top


def best_rect(gain):
    """The rectangle of cells whose gains sum highest (Kadane over every pair of rows): (sum, i0, i1, j0, j1)."""
    best = (0.0, 0, 0, 0, 0)
    n, m = gain.shape
    for i0 in range(n):
        acc = np.zeros(m)
        for i1 in range(i0, n):
            acc += gain[i1]
            run, start = 0.0, 0
            for j in range(m):
                if run <= 0:
                    run, start = acc[j], j
                else:
                    run += acc[j]
                if run > best[0]:
                    best = (run, i0, i1, start, j)
    return best


# Standing on air or walking into an unseen wall is worse than sinking a little into a pit.
BEYOND = 2.0


def fit(xs, ys, top, most=5, least_gain=0.03):
    """Boxes as (centre, half extents) in metres, +Z up, and the error that remains, in cubic metres."""
    # Coarser cells for the search: 10 cm.
    k = 2
    n, m = top.shape[0] // k, top.shape[1] // k
    H = top[: n * k, : m * k].reshape(n, k, m, k).max(axis=(1, 3))
    area = (CELL * k) ** 2
    cover = np.zeros_like(H)
    boxes = []

    def wrong(b):
        return np.where(b > H, (b - H) * BEYOND, H - b)

    def error(b):
        return wrong(b).sum() * area

    for _ in range(most):
        now = error(cover)
        best = None
        for h in np.unique(np.round(np.quantile(H[H > 0], np.linspace(0.05, 1.0, 20)), 2)):
            covered = np.maximum(cover, h)
            gain = wrong(cover) - wrong(covered)
            # No sliver: a box is at least 30 cm each way.
            for _ in range(8):
                s, i0, i1, j0, j1 = best_rect(gain)
                if i1 - i0 >= 2 and j1 - j0 >= 2:
                    break
                gain[i0:i1 + 1, j0:j1 + 1] = np.minimum(gain[i0:i1 + 1, j0:j1 + 1], 0)
                s = 0.0
            if best is None or s > best[0]:
                best = (s, h, i0, i1, j0, j1)
        s, h, i0, i1, j0, j1 = best
        if s * area < least_gain * now and boxes:
            break
        cover[i0:i1 + 1, j0:j1 + 1] = np.maximum(cover[i0:i1 + 1, j0:j1 + 1], h)
        x0, x1 = xs[0] + i0 * k * CELL, xs[0] + (i1 + 1) * k * CELL
        y0, y1 = ys[0] + j0 * k * CELL, ys[0] + (j1 + 1) * k * CELL
        boxes.append(((x0 + x1) / 2, (y0 + y1) / 2, (h + FLOOR) / 2, (x1 - x0) / 2, (y1 - y0) / 2, (h - FLOOR) / 2))
    under = np.clip(H - cover, 0, None)
    over = np.clip(cover - H, 0, None)
    return boxes, {
        "rock": float(H.sum() * area),
        "inside": float(under.sum() * area),
        "beyond": float(over.sum() * area),
        "inside_10cm": float((under > 0.1).mean() / max((H > 0).mean(), 1e-6)),
        "beyond_10cm": float((over > 0.1).mean() / max((H > 0).mean(), 1e-6)),
    }
