"""Bring the Triceratops reference into the neutral, weight-bearing game pose."""

import numpy as np


def smooth(lo, hi, x):
    t = np.clip((x - lo) / (hi - lo), 0, 1)
    return t * t * (3 - 2 * t)


# The original mapping sets the leg and skull rig landmarks. Keep its inverse
# for the ribcage, where the sculpt can retain its proportions independently.
SOURCE_HEIGHTS = [0, 0.5, 1, 1.5, 2, 2.6, 3.22, 4.084]
RIG_HEIGHTS = [0, 0.44, 0.92, 1.44, 1.79, 2.08, 2.49, 3.16]
LENGTH_SCALE = 7.98 / 8.50


TAIL_AT = [-4.25, -3.6, -2.7, -1.8, -.9]
TAIL_DROP = [.71, .63, .40, .12, 0]
SOURCE_STATIONS = [-4.25, -3.6, -2.7, -1.8, -0.78, 0, 0.7, 1.44, 2, 2.42, 3, 3.55, 4.25]
RIG_STATIONS = [-4.5, -3.9, -3.22, -2.59, -1.53, -0.8, -0.18, 0.49, 1.12, 1.48, 2.00, 2.51, 3.45]


def donor_height(along, height):
    source_z = np.interp(along, RIG_STATIONS, SOURCE_STATIONS)
    upright = height + np.interp(source_z, TAIL_AT, TAIL_DROP)
    return np.interp(upright, RIG_HEIGHTS, SOURCE_HEIGHTS) * LENGTH_SCALE


def register(points):
    # Source and target are Blender coordinates. Fit along the sagittal axis
    # first, straightening the source's curled tail and the slight head yaw.
    x, minus_z, h = points.T
    z = -minus_z
    centre = np.interp(
        z,
        [-4.25, -4, -3.5, -3, -2.5, -2, -1, 0, 2, 3, 4.25],
        [1.43, 1.14, 0.67, 0.35, 0.14, 0.02, -0.04, -0.04, -0.10, -0.03, -0.10],
    )
    x = x - centre
    along = np.interp(z, SOURCE_STATIONS, RIG_STATIONS)
    up = np.interp(h, SOURCE_HEIGHTS, RIG_HEIGHTS) - np.interp(z, TAIL_AT, TAIL_DROP)
    # Keep the face level. The broad bony brow and snout sit ahead of the
    # shield while the two long horns rise and project beyond the hooked beak.
    face = smooth(2.15, 2.85, z)
    up += face * np.interp(h, [0, 1.4, 1.65, 2, 2.5, 3.45], [0, -0.02, 0.03, 0.12, 0.18, 0.12])
    # In the photographed stance the far forefoot is 60 cm ahead. Fit each
    # leg through its ankle and knee, fading the correction into its girdle.
    fore = smooth(-0.3, 0.65, z)
    for is_front, band in [(True, fore), (False, 1 - fore)]:
        if is_front:
            a = np.where(x > 0, 1.66, 2.22)
            knee = np.where(x > 0, 1.13, 1.56)
            start = np.interp(h, [0, 0.5, 1.15, 1.85], [0.98, 0.67, 0.12, 0.50])
            source_z = np.where(
                h < 0.5,
                a + (knee - a) * 0.22 * h / 0.5,
                np.where(h < 1.15, a + (knee - a) * (0.22 + 0.78 * (h - 0.5) / 0.65), knee),
            )
            side_x = np.where(x > 0, 0.74, -0.66)
        else:
            a = np.where(x > 0, -0.87, -1.04)
            knee = np.where(x > 0, -0.55, -0.57)
            start = np.interp(h, [0, 0.5, 1.15, 1.85], [-1.30, -1.54, -1.28, -1.5])
            source_z = np.where(
                h < 0.5,
                a - 0.12 * h / 0.5,
                np.where(h < 1.15, a - 0.12 + (knee - a + 0.12) * (h - 0.5) / 0.65, knee),
            )
            side_x = np.where(x > 0, 0.90, -1.04)
        # Every point below the belly in a leg's longitudinal band belongs
        # to that leg, including its medial toe. A lateral falloff there
        # leaves one toe in the donor stance and stretches it off the pad.
        lateral = 1 - smooth(0.64, 1.25, h) * (1 - smooth(0.05, 0.43, abs(x)))
        influence = (
            band
            * (1 - smooth(1.15, 2.12, h))
            * lateral
            * smooth(-2.2, -1.48, z)
            * (1 - smooth(2.65, 2.82, z))
        )
        # Shift the leg centre through the rig joints while keeping the
        # loaded shank and broad foot at the donor's uniform body scale.
        along += influence * (start + (z - source_z) * LENGTH_SCALE - along)
        x += influence * (np.sign(x) * 0.86 + (x - side_x) * LENGTH_SCALE - x)
    return np.column_stack((x, -along, up))
