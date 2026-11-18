"""Physical landmarks shared by the cranial surface, its pigment and its relief maps."""

import numpy as np

# Labial scale stations. Each neighbouring pair bounds one broad irregular scale.
SCALE_EDGES = (3.38, 3.58, 3.77, 3.90, 4.075, 4.185, 4.342, 4.472, 4.634, 4.743, 4.879, 4.988, 5.092, 5.17)
HEIGHTS = (0.184, 0.160, 0.198, 0.145, 0.183, 0.128, 0.168, 0.143, 0.162, 0.133, 0.145, 0.128, 0.111)
SLANTS = (0.14, 0.29, 0.23, 0.06, -0.15, -0.18, -0.25, -0.08, 0.06, 0.13, 0.16, -0.04, -0.09)


def lip_at(z):
    return np.interp(
        z,
        (2.85, 3.05, 3.34, 3.49, 3.75, 4.10, 4.27, 4.55, 4.86, 5.14),
        (3.38, 3.37, 3.55, 3.555, 3.451, 3.37, 3.36, 3.39, 3.45, 3.52),
    )


def labials(z, y):
    above = y - lip_at(z)
    plate = np.zeros_like(z, dtype=float)
    margin = np.zeros_like(plate)
    for i, (left, right) in enumerate(zip(SCALE_EDGES, SCALE_EDGES[1:])):
        middle = (left + right) * 0.5
        height = HEIGHTS[i]
        # A slanted quadrilateral with a rounded crown next to the lip.
        forward = (z - middle - SLANTS[i] * (above - 0.088)) / ((right - left) * 0.489)
        vertical = (above - 0.53 * height) / (0.50 * height)
        distance = abs(forward) ** 3.5 + abs(vertical) ** 4
        plate = np.maximum(plate, np.exp(-0.71 * np.minimum(distance, 30)))
        margin = np.maximum(margin, np.exp(-(((np.minimum(distance, 5) - 1.2) / 0.61) ** 2)))
    return plate, margin


def cheek_folds(z, y):
    raised = np.zeros_like(z, dtype=float)
    crease = np.zeros_like(raised)
    # Posterior folds spread down and toward the mouth corner. The ascending
    # maxillary fold runs under the fossa and dies out before the nostril.
    for start, mid, h, length, sag, width in [
        (3.02, 3.285, 3.610, 0.37, 0.23, 0.052),
        (3.16, 3.36, 3.663, 0.37, 0.24, 0.042),
        (3.28, 3.56, 3.72, 0.45, 0.19, 0.048),
        (3.58, 4.01, 3.738, 0.48, 0.12, 0.043),
        (2.97, 3.23, 3.15, 0.30, 0.13, 0.044),
        (3.12, 3.44, 3.18, 0.39, 0.089, 0.036),
    ]:
        taper = np.exp(-(((z - mid) / length) ** 4))
        line = h + sag * np.exp(-(((z - start) / (0.72 * length)) ** 2)) - 0.032 * (z - mid)
        raised = np.maximum(raised, taper * np.exp(-(((y - line) / width) ** 2)))
        crease = np.maximum(crease, taper * np.exp(-(((y - line + width * 0.96) / (width * 0.49)) ** 2)))
    return raised, crease
