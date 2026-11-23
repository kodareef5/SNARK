"""The SV-4 survey drone, in its own axes: nose along +Z, its skids on y = 0. The racked copies in the trailer use
the same shape at a lower detail, so the drone that launches is the one that sat in the bay."""

import math

from kit import MIRROR, T, R, rounded

IMPELLERS = [(-0.36, 0.12, -0.36), (-0.36, 0.12, 0.235), (0.36, 0.12, -0.36), (0.36, 0.12, 0.235)]
GIMBAL = (0, 0.1, 0.53)
DUCT_IN = 0.168
DUCT_OUT = 0.192


def section(w, low, top):
    """A faceted fuselage section: flat belly, chined sides, a ridged back."""
    h = top - low
    half = [(0.45 * w, low), (w, low + 0.36 * h), (0.8 * w, low + 0.72 * h), (0.32 * w, top), (0.0, top)]
    return half + [(-x, y) for x, y in reversed(half[:-1])]


def ring(points, z):
    return [(x, y, z) for x, y in points]


def build(kit, bones, full=True):
    """Emits the drone. bones: the bone for "chassis", "gimbal" and each "impeller_N"."""
    seg = 28 if full else 12
    least = kit.least_bevel
    kit.least_bevel = 0.0 if full else 1.0
    with kit.on(bones["chassis"]):
        # Fuselage: a lofted faceted body, slung low between the ducts.
        stations = [(-0.60, 0.05, 0.14, 0.2), (-0.50, 0.1, 0.1, 0.235), (-0.30, 0.135, 0.07, 0.262), (0.05, 0.15, 0.062, 0.275),
                    (0.30, 0.14, 0.065, 0.245), (0.44, 0.11, 0.075, 0.195), (0.50, 0.075, 0.09, 0.16)]
        rings = [ring(section(w, lo, hi), z) for z, w, lo, hi in stations]
        # Dark flanks and belly, a gunmetal back: faces 2 to 5 of each section are the shoulders and the ridge.
        kit.loft(rings, "panel_d", cap="panel_b", tags=lambda r, i: "panel_b" if 2 <= i <= 5 else "panel_d")
        # Canted tail fins.
        for s in (1, -1):
            with kit.at(T(s * 0.06, 0.205, 0) @ R("z", -s * 0.5)):
                kit.prism([(-0.62, 0.0), (-0.44, 0.0), (-0.53, 0.1), (-0.62, 0.1)], "x", -0.006, 0.006, "panel_b")
            if full:
                with kit.at(T(s * 0.06, 0.205, 0) @ R("z", -s * 0.5)):
                    kit.cbox((0, 0.095, -0.61), (0.014, 0.01, 0.02), "lamp_red" if s > 0 else "lamp_green")
        # A carbon spine over the back and a raised avionics hatch.
        kit.box((-0.06, 0.262, -0.26), (0.06, 0.282, 0.16), "carbon", bevel=0.008)
        kit.box((-0.045, 0.27, -0.42), (0.045, 0.285, -0.3), "hex", bevel=0.006)
        if full:
            for z in (-0.2, -0.05, 0.1):
                kit.box((-0.062, 0.281, z - 0.004), (0.062, 0.284, z + 0.004), "seam")
            # Chin sensor fairing under the nose, ahead of the gimbal mount.
            kit.box((-0.05, 0.06, 0.32), (0.05, 0.09, 0.45), "panel_b", bevel=0.012)
        # Side intakes with hex screens.
        for s in (1, -1):
            x = s * 0.148
            kit.box((min(x, x + s * 0.012), 0.12, -0.18), (max(x, x + s * 0.012), 0.205, 0.08), "panel_b", bevel=0.004)
            if full:
                kit.box((min(x + s * 0.008, x + s * 0.016), 0.13, -0.17), (max(x + s * 0.008, x + s * 0.016), 0.195, 0.07), "hex")
                kit.decal((x + s * 0.016, 0.163, -0.05), (s, 0, 0), (0, 0, -s), 0.22, 0.05, "text_drone", lift=0.002)
        # Arms: swept, tapered beams from the body to each duct's ring.
        for (x, y, z) in IMPELLERS:
            s = 1 if x > 0 else -1
            root = (s * 0.11, 0.17, z * 0.45 + 0.02)
            tip = (x - s * (DUCT_OUT - 0.01), 0.13, z)
            kit.beam(root, tip, 0.05, 0.034, "panel_d", bevel=0.008)
            if full:
                kit.beam((root[0], root[1] + 0.017, root[2]), (tip[0], tip[1] + 0.015, tip[2]), 0.022, 0.006, "carbon")
            # The duct: a shroud with a rolled inlet lip and a dark band, open top and bottom.
            prof = [(0.0, DUCT_IN + 0.004), (0.045, DUCT_IN), (0.068, DUCT_IN + 0.01), (0.076, DUCT_OUT - 0.002),
                    (0.07, DUCT_OUT + 0.006), (0.03, DUCT_OUT + 0.004), (0.0, DUCT_OUT - 0.004), (-0.006, DUCT_IN + 0.012)]
            if not full:
                prof = [(0.0, DUCT_IN), (0.075, DUCT_IN), (0.075, DUCT_OUT), (0.0, DUCT_OUT)]
            kit.lathe((x, 0.085, z), (x, 0.2, z), prof, "duct", seg, loop=True)
            # Motor pod on three stator vanes, and the guard across the top.
            kit.cylinder((x, 0.085, z), (x, 0.13, z), 0.036, "panel_b", 12 if full else 8, r2=0.03, cap="dark", bevel=0.006)
            for k in range(3 if full else 0):
                a = k * math.tau / 3 + 0.3
                kit.beam((x + math.cos(a) * 0.03, 0.1, z + math.sin(a) * 0.03), (x + math.cos(a) * (DUCT_IN + 0.004), 0.1, z + math.sin(a) * (DUCT_IN + 0.004)), 0.006, 0.026, "dark")
            for k in range(3 if full else 2):
                a = k * math.pi / (3 if full else 2) + 0.25
                kit.beam((x - math.cos(a) * (DUCT_IN + 0.012), 0.161, z - math.sin(a) * (DUCT_IN + 0.012)),
                         (x + math.cos(a) * (DUCT_IN + 0.012), 0.161, z + math.sin(a) * (DUCT_IN + 0.012)), 0.007, 0.008, "steel")
            if full:
                kit.lathe((x, 0.157, z), (x, 0.165, z), [(0, 0.085), (0, 0.093), (0.008, 0.093), (0.008, 0.085)], "steel", 18, loop=True)
                kit.lathe((x, 0.157, z), (x, 0.165, z), [(0, 0.14), (0, 0.148), (0.008, 0.148), (0.008, 0.14)], "steel", 22, loop=True)
            # Navigation light on the duct's outer rim: red to the left, green to the right.
            nz = z + (0.0 if z > 0 else 0.0)
            kit.cbox((x + s * (DUCT_OUT + 0.004), 0.14, nz), (0.012, 0.018, 0.03), "lamp_red" if s > 0 else "lamp_green", bevel=0.003)
        # Skids on raked struts, clear of the payload pod.
        for s in (1, -1):
            x = s * 0.17
            kit.tube([(x, 0.014, -0.3), (x, 0.012, 0.22), (x, 0.03, 0.3)], 0.012, "rubber", 8 if full else 4)
            for z in (-0.18, 0.14):
                kit.beam((x, 0.014, z), (s * 0.11, 0.1, z + 0.02), 0.022, 0.012, "steel", bevel=0.003)
        # Payload pod with a sensor window, on a short pylon.
        kit.box((-0.03, 0.06, -0.1), (0.03, 0.08, 0.08), "panel_b", bevel=0.006)
        pod = [ring(section(w, lo, hi), z) for z, w, lo, hi in [(-0.17, 0.03, 0.03, 0.05), (-0.1, 0.06, 0.022, 0.065), (0.08, 0.06, 0.022, 0.065), (0.17, 0.035, 0.03, 0.055)]]
        kit.loft(pod, "panel_l", cap="panel_b")
        if full:
            kit.decal((0, 0.022, 0.0), (0, -1, 0), (1, 0, 0), 0.06, 0.06, "glass", lift=0.001)
            kit.cylinder((0, 0.04, 0.165), (0, 0.04, 0.178), 0.012, "dark", 10, cap="lens")
        # GPS puck, data link whip, tail strobe and status lamp.
        kit.cylinder((0, 0.282, 0.05), (0, 0.3, 0.05), 0.03, "panel_l", 14 if full else 8, r2=0.026, bevel=0.005)
        if full:
            kit.tube([(0.0, 0.24, -0.52), (0.0, 0.31, -0.56)], 0.004, "dark", 5)
            kit.cbox((0, 0.285, -0.2), (0.03, 0.006, 0.012), "lamp_amber", bevel=0.002)
        kit.cbox((0, 0.165, -0.605), (0.03, 0.02, 0.012), "lamp_white", bevel=0.003)
    with kit.on(bones["gimbal"]):
        gx, gy, gz = GIMBAL
        # Pan bearing under the chin, a yoke, and the stabilised camera ball with its lens.
        kit.cylinder((gx, 0.068, gz - 0.015), (gx, 0.09, gz - 0.015), 0.035, "steel", 14 if full else 8)
        for s in (1, -1):
            kit.beam((s * 0.058, 0.075, gz - 0.015), (s * 0.058, gy, gz), 0.012, 0.03, "panel_b", bevel=0.003)
        prof = [(0, 0)] + [(0.05 - 0.05 * math.cos(a), 0.05 * math.sin(a)) for a in [k * math.pi / (8 if full else 5) for k in range(1, (8 if full else 5))]] + [(0.1, 0)]
        kit.lathe((gx - 0.05, gy, gz), (gx + 0.05, gy, gz), prof, "dark", 16 if full else 8)
        kit.cylinder((gx, gy, gz + 0.035), (gx, gy, gz + 0.058), 0.03, "panel_d", 16 if full else 8, cap="lens", bevel=0.004 if full else 0)
        if full:
            kit.cylinder((gx + 0.03, gy + 0.026, gz + 0.03), (gx + 0.03, gy + 0.026, gz + 0.05), 0.009, "dark", 8, cap="glass")
    for k, (x, y, z) in enumerate(IMPELLERS):
        with kit.on(bones[f"impeller_{k + 1}"]):
            # Hub spinner and five twisted blades. Turn alternates, so the blades' twist does too.
            turn = (1, -1, -1, 1)[k]
            kit.lathe((x, 0.098, z), (x, 0.142, z), [(0, 0.03), (0.024, 0.03), (0.036, 0.018), (0.044, 0)] if full else [(0, 0.03), (0.03, 0.025), (0.044, 0)], "panel_b", 12 if full else 6)
            for b in range(5 if full else 3):
                a = b * math.tau / (5 if full else 3)
                rings = []
                for r, chord, pitch in ((0.03, 0.05, 0.6), (0.1, 0.045, 0.4), (DUCT_IN - 0.006, 0.034, 0.22))[::1 if full else 2]:
                    pitch *= turn
                    pts = []
                    for c, t in ((-0.5, 0), (0.0, 0.5), (0.5, 0), (0.0, -0.5)):
                        cc = c * chord
                        tt = t * 0.007
                        lx, ly = cc * math.cos(pitch) - tt * math.sin(pitch), cc * math.sin(pitch) + tt * math.cos(pitch)
                        px, pz = r, lx
                        pts.append((x + px * math.cos(a) - pz * math.sin(a), 0.122 + ly, z + px * math.sin(a) + pz * math.cos(a)))
                    rings.append(pts)
                kit.loft(rings, "blade")
    kit.least_bevel = least
