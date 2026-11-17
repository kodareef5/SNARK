"""Parametric coachbuilt vans, in metres in SNARK's +Y-up, +Z-forward vehicle frame."""

from pathlib import Path
import json
import math
import sys
from types import SimpleNamespace

import bmesh
import bpy
from surfaces import TILE

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "compact"))
from parts import E2B, Part, cylinder, lathe, rbox, tags_of


def lerp(a, b, t):
    return a + t * (b - a)


def curve(points, p):
    for (a, va), (b, vb) in zip(points, points[1:]):
        if p <= b:
            return lerp(va, vb, max(0.0, (p - a) / (b - a)))
    return points[-1][1]


def samples(a, b, steps):
    return [lerp(a, b, k / steps) for k in range(steps + 1)]


class Coach:
    def __init__(self, kind, d):
        self.kind = kind
        self.cargo = kind == "panel_van"
        self.dimensions = d
        self.bone = "chassis"
        self.objects = []
        self.height = d.height
        self.rear = -d.halfLength + 0.148
        self.nose = d.halfLength - 0.129
        self.roof_front = 0.84 if self.cargo else 0.58
        self.cowl = 1.79 if self.cargo else 1.65
        self.roof_end = self.rear + 0.035
        self.bottom = 0.37 if self.cargo else 0.285
        self.floor = d.seatY - 0.435
        self.roof_profile = (
            [
                (self.rear, 2.36),
                (-2.56, 2.438),
                (-2.34, 2.46),
                (-0.30, 2.464),
                (0.06, 2.43),
                (0.42, 2.34),
                (0.84, 2.115),
                (1.79, 1.31),
            ]
            if self.cargo
            else [
                (self.rear, 1.52),
                (-2.28, 1.62),
                (-1.93, 1.695),
                (-1.50, 1.747),
                (-0.6, 1.774),
                (0.08, 1.752),
                (0.39, 1.726),
                (0.58, 1.685),
                (0.70, 1.632),
                (1.39, 1.203),
                (1.65, 1.05),
            ]
        )
        self.joints = self.bones()

    def bones(self):
        d = self.dimensions
        result = {"chassis": (0, 0, 0)}
        for end, z in (("front", d.halfWheelbase), ("rear", -d.halfWheelbase)):
            for side, sg in (("left", 1), ("right", -1)):
                result[f"wheel_{end}_{side}"] = (sg * d.halfTrack, d.wheelRadius, z)
        for side, sg in (("left", 1), ("right", -1)):
            result["door_" + side] = (sg * d.hingeX, d.hingeY, d.hingeZ)
        result["steering_wheel"] = (d.seatX, d.steeringY, d.steeringZ)
        for side, sg in (("left", 1), ("right", -1)):
            if not self.cargo or sg == -1:
                result["door_slide_" + side] = (sg * d.slideX, d.slideY, d.slideZ)
        return result

    def add(self, o):
        self.objects.append((self.bone, o))
        return o

    def box(self, name, lo, hi, tag, radius=0.014, seg=1):
        return self.add(
            rbox(name, tuple(min(a, b) for a, b in zip(lo, hi)), tuple(max(a, b) for a, b in zip(lo, hi)), radius, tag, seg)
        )

    def rod(self, name, a, b, r, tag, n=10, r2=None):
        return self.add(cylinder(name, a, b, r, tag, n, r2))

    def lathe(self, name, centre, sg, profile, segments, tag):
        p = Part()
        lathe(p, centre, sg, profile, segments, tag)
        return self.add(p.obj(name))

    def patch(self, name, outer, inside, outer_tag, inside_tag, edge_tag):
        """Closed sheet swept in two directions. Keep the shared index grid at each side of the sheet."""
        p = Part()
        grids = [[[p.v(v) for v in row] for row in layer] for layer in (outer, inside)]
        m, n = len(outer), len(outer[0])
        for layer, tag in zip(grids, (outer_tag, inside_tag)):
            for i in range(m - 1):
                for j in range(n - 1):
                    p.face(
                        [layer[i][j], layer[i + 1][j], layer[i + 1][j + 1], layer[i][j + 1]], tag(i, j) if callable(tag) else tag
                    )
        border = (
            [(i, 0) for i in range(m)]
            + [(m - 1, j) for j in range(1, n)]
            + [(i, n - 1) for i in reversed(range(m - 1))]
            + [(0, j) for j in reversed(range(1, n - 1))]
        )
        for (i, j), (k, l) in zip(border, border[1:] + border[:1]):
            p.face([grids[0][i][j], grids[0][k][l], grids[1][k][l], grids[1][i][j]], edge_tag)
        return self.add(p.obj(name))

    def ring(self, name, rings, tags, wrap=False):
        p = Part()
        ids = [[p.v(v) for v in ring] for ring in rings]
        for i in range(len(rings) if wrap else len(rings) - 1):
            j = (i + 1) % len(rings)
            for a in range(len(ids[i])):
                b = (a + 1) % len(ids[i])
                p.face(
                    [ids[i][a], ids[i][b], ids[j][b], ids[j][a]],
                    tags(i, a) if callable(tags) else (tags[i] if isinstance(tags, list) else tags),
                )
        if not wrap:
            p.face(list(reversed(ids[0])), tags[0] if isinstance(tags, list) else tags)
            p.face(ids[-1], tags[-1] if isinstance(tags, list) else tags)
        return self.add(p.obj(name))

    def top(self, z):
        return curve(self.roof_profile, z)

    def belt(self, z):
        d = self.dimensions
        return curve(
            [
                (self.rear, d.beltline + (0.008 if self.cargo else 0.075)),
                (-1.65, d.beltline + 0.035),
                (-0.50, d.beltline + 0.005),
                (0.25, d.beltline - 0.022),
                (self.cowl, d.beltline),
                (self.nose - 0.19, d.beltline - (0.24 if self.cargo else 0.20)),
                (self.nose, d.beltline - (0.31 if self.cargo else 0.255)),
            ],
            z,
        )

    def arch(self, z):
        r = self.dimensions.wheelRadius + (0.087 if self.cargo else 0.071)
        dz = abs(abs(z) - self.dimensions.halfWheelbase)
        return self.dimensions.wheelRadius + math.sqrt(max(0, r * r - dz * dz)) if dz < r else self.bottom

    def side(self, sg, z, y, proud=0):
        b = self.belt(z)
        side_curve = curve(
            [
                (0, -0.09),
                (self.bottom, -0.058),
                (self.bottom + 0.092, -0.010),
                (b - 0.25, -0.002),
                (b - 0.065, 0),
                (b - 0.035, -0.012),
                (b, -0.006),
                (b + 0.08, -0.022),
                (self.height - 0.14, -(0.092 if self.cargo else 0.124)),
                (self.height, -0.155),
            ],
            y,
        )
        taper = curve(
            [
                (self.rear, 0.115),
                (self.rear + 0.09, 0.050),
                (self.rear + 0.25, 0.010),
                (self.rear + 0.48, 0),
                (self.cowl + 0.12, 0),
                (self.nose - 0.35, 0.032),
                (self.nose - 0.12, 0.079),
                (self.nose, 0.143),
            ],
            z,
        )
        # The rear hatch leans forward from its belt, the different rooflines sharing the same floor construction.
        tail_lean = max(0, 1 - (z - self.rear) / 0.64) * max(0, y - self.belt(self.rear)) * (0.08 if self.cargo else 0.42)
        nose_sweep = 0 if self.cargo else 0.148 * max(0, (z - self.cowl) / (self.nose - self.cowl)) ** 2.4
        return (sg * (self.dimensions.bodyHalf + side_curve - taper + proud), y, z + tail_lean - nose_sweep)

    def lower_side(self, sg, start, end):
        r = self.dimensions.wheelRadius + (0.087 if self.cargo else 0.071)
        zs = samples(start, end, max(2, math.ceil((end - start) / 0.18)))
        for axle in (-self.dimensions.halfWheelbase, self.dimensions.halfWheelbase):
            for k in range(19):
                z = axle + r * math.cos(k * math.pi / 18)
                if start + 0.009 < z < end - 0.009 and all(abs(z - q) > 0.003 for q in zs):
                    zs.append(z)
        zs = sorted(zs)
        outer, inner = [], []
        for z in zs:
            low, belt = max(self.bottom, self.arch(z)), self.belt(z)
            ys = [low, lerp(low, belt, 0.075), lerp(low, belt, 0.39), lerp(low, belt, 0.67), lerp(low, belt, 0.915), belt]
            outer.append([self.side(sg, z, y) for y in ys])
            inner.append([self.side(sg, z, y, -0.049) for y in ys])
        self.patch(
            "lower skin",
            outer,
            inner,
            lambda i, j: "sill" if self.cargo and j == 0 else ("lower" if j < 3 else "enamel"),
            "doorcard",
            "seam",
        )

    @staticmethod
    def contour():
        # Clockwise perimeter with radiused corners, sampled through fender and window curvature.
        out = []
        for a, b in [((0.06, 0), (0.94, 0)), ((1, 0.10), (1, 0.90)), ((0.94, 1), (0.06, 1)), ((0, 0.90), (0, 0.10))]:
            for t in (0, 0.25, 0.5, 0.75, 1):
                out.append((lerp(a[0], b[0], t), lerp(a[1], b[1], t)))
        return out

    def upper_side(self, sg, a, b, mode):
        pane = mode in {"window", "open"}
        # Outer perimeter nearly square at the roof join. The inset has a radiused reveal and a rolled seal.
        shape = self.contour()

        def layer(u0, u1, v0, v1, proud):
            result = []
            for u, v in shape:
                if u0 == 0 and v0 == 0:
                    # The stamping fills the pillar corners; only its window or recessed centre is rounded.
                    u = curve([(0, 0), (0.06, 0.003), (0.94, 0.997), (1, 1)], u)
                    v = curve([(0, 0), (0.10, 0.006), (0.90, 0.994), (1, 1)], v)
                z = lerp(a, b, lerp(u0, u1, u))
                y = lerp(self.belt(z) - 0.009, self.top(z) + 0.012, lerp(v0, v1, v))
                result.append(self.side(sg, z, y, proud))
            return result

        inner_u = 0.048 if pane else 0.069
        inner_v = 0.085 if pane else 0.107
        rings = [
            layer(0, 1, 0, 1, -0.012),
            layer(inner_u, 1 - inner_u, inner_v, 1 - inner_v, -0.008),
            layer(inner_u + 0.018, 1 - inner_u - 0.018, inner_v + 0.024, 1 - inner_v - 0.024, -0.028),
            layer(inner_u + 0.02, 1 - inner_u - 0.02, inner_v + 0.025, 1 - inner_v - 0.025, -0.054),
            layer(0, 1, 0, 1, -0.059),
        ]

        def reveal(i, k):
            if (
                i == 0
                and pane
                and not self.cargo
                and ((4 <= k < 10 and b < self.dimensions.hingeZ) or (14 <= k < 20 and a > self.rear + 0.02))
            ):
                return "rubber"
            return [
                "enamel",
                "rubber" if pane else "lip",
                "rubber" if pane else "pressed",
                "doorcard" if pane else "lining",
                "seam",
            ][i]

        self.ring("window reveal" if pane else "side pressing", rings, reveal, True)
        if mode != "open":
            start = inner_u + 0.015
            bottom = inner_v + 0.018
            self.ring(
                "side glazing" if pane else "drawn inset",
                [layer(start, 1 - start, bottom, 1 - bottom, -0.029), layer(start, 1 - start, bottom, 1 - bottom, -0.045)],
                ["glass" if pane else "pressed", "invisible" if pane else "ply"],
            )

    def side_band(self, name, sg, a, b, heights, tag, proud=0.014):
        zs = samples(a, b, 8)

        def points(z, off):
            lo, hi = heights(z)
            return [self.side(sg, z, y, off) for y in (lo, hi)]

        self.patch(name, [points(z, proud) for z in zs], [points(z, proud - 0.023) for z in zs], tag, tag, tag)

    def arch_trim(self, sg, axle):
        r = self.dimensions.wheelRadius + (0.087 if self.cargo else 0.071)
        outer, inner = [], []
        for ang in samples(0.015, math.pi - 0.015, 20):
            row = []
            for rr in (r - 0.004, r + 0.009, r + 0.029):
                y = self.dimensions.wheelRadius + rr * math.sin(ang)
                z = axle + rr * math.cos(ang)
                row.append(self.side(sg, z, y, 0.010 if rr < r + 0.015 else 0.004))
            outer.append(row)
            inner.append([(x - sg * 0.041, y, z) for x, y, z in row])
        self.patch("rolled arch", outer, inner, "lip", "wheelhouse", "wheelhouse")
        # The closed arch liner, above the tire tread, can be seen through the fender clearance.
        liner = [
            [
                (
                    self.side(sg, axle, self.bottom)[0] - sg * w,
                    self.dimensions.wheelRadius + (r - 0.003) * math.sin(t),
                    axle + (r - 0.003) * math.cos(t),
                )
                for w in (0.02, 0.29)
            ]
            for t in samples(0, math.pi, 22)
        ]
        self.patch(
            "arch tub", liner, [[(x, y + 0.021, z) for x, y, z in row] for row in liner], "wheelhouse", "wheelhouse", "wheelhouse"
        )

    def door_fittings(self, sg, z, slider):
        b = self.dimensions.beltline
        x = sg * (self.dimensions.bodyHalf - 0.019)
        self.box("handle pocket", (x - sg * 0.006, b - 0.195, z - 0.103), (x + sg * 0.020, b - 0.112, z + 0.102), "seam", 0.030)
        self.box(
            "pull handle",
            (x + sg * 0.013, b - 0.155, z - 0.084),
            (x + sg * 0.039, b - 0.126, z + 0.095),
            "rubstrip" if self.cargo else "chrome",
            0.013,
        )
        self.box("armrest", (x - sg * 0.132, b - 0.37, z - 0.07), (x - sg * 0.051, b - 0.29, z + 0.34), "doorcard", 0.029)
        self.box("inside pull", (x - sg * 0.145, b - 0.277, z + 0.03), (x - sg * 0.094, b - 0.246, z + 0.19), "aluminium", 0.012)
        if slider:
            return
        y = b + 0.085
        fx = self.dimensions.hingeZ - 0.065
        self.rod(
            "mirror stay",
            (sg * (self.dimensions.bodyHalf - 0.064), y - 0.06, fx + 0.035),
            (sg * (self.dimensions.halfWidth - 0.064), y, fx),
            0.031,
            "rubber",
        )
        self.box(
            "mirror housing",
            (sg * (self.dimensions.halfWidth - 0.167), y - 0.082, fx - 0.099),
            (sg * self.dimensions.halfWidth, y + 0.089, fx + 0.067),
            "rubstrip" if self.cargo else "enamel",
            0.045,
            3,
        )
        self.box(
            "looking glass",
            (sg * (self.dimensions.halfWidth - 0.150), y - 0.057, fx - 0.104),
            (sg * (self.dimensions.halfWidth - 0.018), y + 0.065, fx - 0.093),
            "mirror",
            0.015,
        )

    def sides(self):
        split = 0.20 if self.cargo else 0.16
        front = self.dimensions.hingeZ + 0.045
        rear = split - (1.32 if self.cargo else 1.13)
        for sg, side in ((1, "left"), (-1, "right")):
            slider = not self.cargo or sg == -1
            for a, b, bone, mode in [
                (self.rear, rear - 0.008, "chassis", "pressed" if self.cargo else "window"),
                (
                    rear + 0.008,
                    split - 0.009,
                    "door_slide_" + side if slider else "chassis",
                    "pressed" if self.cargo else "window",
                ),
                (split + 0.009, front - 0.009, "door_" + side, "open"),
                (front + 0.010, self.nose, "chassis", None),
            ]:
                self.bone = bone
                self.lower_side(sg, a, b)
                if mode:
                    self.upper_side(sg, a, b, mode)
                if mode == "open":
                    self.door_fittings(sg, a + 0.16, False)
                elif bone.startswith("door_slide"):
                    self.door_fittings(sg, b - 0.15, True)
                aa, bb = (
                    max(a + 0.035, -self.dimensions.halfWheelbase + 0.46),
                    min(b - 0.035, self.dimensions.halfWheelbase - 0.46),
                )
                if bb - aa > 0.10:
                    self.side_band(
                        "impact strip",
                        sg,
                        aa,
                        bb,
                        lambda z: (self.bottom + 0.176, self.bottom + (0.255 if self.cargo else 0.204)),
                        "rubstrip" if self.cargo else "highlight",
                    )
            self.bone = "chassis"
            for jamb_z in (split, rear):
                b = self.belt(jamb_z)
                top = self.top(jamb_z)
                ys = [self.floor - 0.03, b - 0.05, b + 0.015, lerp(b, top, 0.5), top + 0.024]
                rings = []
                for y in ys:
                    w = 0.039 if y > b else 0.046
                    rings.append(
                        [self.side(sg, jamb_z + dz, y, off) for dz, off in ((-w, -0.065), (w, -0.065), (w, -0.120), (-w, -0.120))]
                    )
                self.ring("body pillar", rings, ["doorcard", "rubber", "rubber", "rubber", "rubber"])
            self.side_band(
                "fixed sill", sg, rear - 0.02, front + 0.03, lambda z: (self.floor - 0.041, self.floor + 0.026), "sill", -0.068
            )
            self.side_band(
                "roof gutter",
                sg,
                self.roof_end + 0.018,
                self.roof_front - 0.025,
                lambda z: (self.top(z) - 0.008, self.top(z) + 0.022),
                "lip",
                0.005,
            )
            self.side_band(
                "interior header rail",
                sg,
                self.roof_end + 0.015,
                self.roof_front + 0.005,
                lambda z: (self.top(z) - 0.058, self.top(z) + 0.015),
                "headliner",
                -0.066,
            )
            self.upper_side(sg, front + 0.007, self.cowl - 0.035, "window")
            for axle in (-self.dimensions.halfWheelbase, self.dimensions.halfWheelbase):
                self.arch_trim(sg, axle)
            if slider:
                self.side_band(
                    "guide rail",
                    sg,
                    self.rear + 0.19,
                    rear - 0.021,
                    lambda z: (self.dimensions.beltline - 0.045, self.dimensions.beltline + 0.002),
                    "seam",
                    0.013,
                )
            if self.cargo:
                # Fleet's black rub rail wraps each rear quarter, clear of the wheel.
                self.side_band(
                    "rear protector",
                    sg,
                    self.rear + 0.065,
                    -self.dimensions.halfWheelbase - 0.49,
                    lambda z: (0.59, 0.68),
                    "rubstrip",
                )

    def cap_point(self, z, u, zone):
        y = self.belt(z) if zone == "hood" else self.top(z)
        x, _, zz = self.side(1, z, y, -0.007)
        roundness = 1 - abs(u) ** 3
        if zone == "hood":
            along = max(0, min(1, (z - self.cowl) / (self.nose - self.cowl)))
            rise = 0.034 * roundness if self.cargo else (0.080 + 0.018 * along) * roundness + 0.012 * (math.sin(math.pi * u) ** 4)
            sweep = (0.033 if self.cargo else lerp(0.072, 0.216, along**1.65)) * roundness
        else:
            # A curved windscreen meets the cowl at a shallow centre bow, then rolls into the painted pillars.
            along = max(0, min(1, (z - self.roof_front) / (self.cowl - self.roof_front)))
            rise = (0.056 if self.cargo else lerp(0.056, 0.080, along)) * roundness
            sweep = (0 if self.cargo else 0.020 + 0.052 * along + 0.034 * math.sin(math.pi * along)) * roundness
        return (x * u, y + rise, zz + sweep)

    def roof_and_hood(self):
        for zone, a, b, tag in (("roof", self.roof_end, self.roof_front, "roof"), ("hood", self.cowl - 0.008, self.nose, "hood")):
            zs = sorted(set(samples(a, b, 14) + [v for v, _ in self.roof_profile if a < v < b]))
            us = [-1, -0.96, -0.86, -0.69, -0.49, 0, 0.49, 0.69, 0.86, 0.96, 1]
            outer = [[self.cap_point(z, u, zone) for u in us] for z in zs]
            self.patch(
                zone,
                outer,
                [[(x, y - 0.052, z) for x, y, z in row] for row in outer],
                tag,
                "headliner" if zone == "roof" else "under",
                "enamel",
            )
        # Real folded channels along the high roof; flush rack rails on the touring roof.
        if self.cargo:
            for u in (-0.71, -0.47, -0.23, 0.0, 0.23, 0.47, 0.71):
                zs = samples(-2.48, 0.04, 14)
                outside = [[self.cap_point(z, u + du, "roof") for du in (-0.013, 0, 0.013)] for z in zs]
                self.patch(
                    "roof swage",
                    [[(x, y - 0.004 if k != 1 else y + 0.002, z) for k, (x, y, z) in enumerate(r)] for r in outside],
                    [[(x, y - 0.008, z) for x, y, z in r] for r in outside],
                    "roof",
                    "roof",
                    "roof",
                )
        else:
            for sg in (1, -1):
                zs = samples(-1.96, 0.26, 14)
                rail = []
                for z in zs:
                    x, y, _ = self.cap_point(z, 0.80 * sg, "roof")
                    lift = 0.008 + 0.008 * math.sin((z + 1.96) / 2.22 * math.pi)
                    rail.append(
                        [
                            (x - sg * 0.020, y + lift - 0.014, z),
                            (x + sg * 0.017, y + lift - 0.014, z),
                            (x + sg * 0.017, y + lift + 0.011, z),
                            (x - sg * 0.020, y + lift + 0.011, z),
                        ]
                    )
                self.ring("roof rail", rail, "rubstrip")
                for z in (-1.91, -0.82, 0.21):
                    x, y, _ = self.cap_point(z, 0.80 * sg, "roof")
                    self.box("rack foot", (x - 0.030, y - 0.015, z - 0.070), (x + 0.030, y + 0.030, z + 0.070), "rubber", 0.016)

    def windshield(self):
        def point(u, v, off=0):
            z = lerp(self.cowl, self.roof_front, v)
            x, y, zz = self.cap_point(z, u, "roof")
            return (x, y + off, zz + off * 0.65)

        def perimeter(u, bottom, top, rx, ry, off):
            # Follow the compound curvature along all four sides, with rounded bonded corners.
            corners = [
                (u - rx, bottom + ry, -math.pi / 2),
                (u - rx, top - ry, 0),
                (-u + rx, top - ry, math.pi / 2),
                (-u + rx, bottom + ry, math.pi),
            ]
            arcs = [
                [(x + rx * math.cos(a), y + ry * math.sin(a)) for a in samples(angle, angle + math.pi / 2, 3)]
                for x, y, angle in corners
            ]
            points = []
            for i, arc in enumerate(arcs):
                points.extend(arc)
                x0, y0 = arc[-1]
                x1, y1 = arcs[(i + 1) % 4][0]
                points.extend((lerp(x0, x1, t), lerp(y0, y1, t)) for t in (0.17, 0.34, 0.50, 0.66, 0.83))
            return [point(x, y, off) for x, y in points]

        # A closed annulus retains the frit, glass edge and a tinted sun strip. The physical
        # clear aperture also works on low poly and before pictures arrive, when cutouts do not draw.
        aperture = (0.884, 0.043, 0.805, 0.080, 0.054)
        frit = (0.939, 0.026, 0.930, 0.045, 0.029)
        steel = (0.963, 0.016, 0.956, 0.025, 0.017)
        outer = (1, 0, 1, 0.006, 0.005)
        self.ring(
            "bonded windscreen",
            [
                perimeter(*outer, 0),
                perimeter(*steel, 0),
                perimeter(*frit, -0.002),
                perimeter(*aperture, -0.005),
                perimeter(*aperture, -0.017),
                perimeter(*frit, -0.025),
                perimeter(*steel, -0.029),
                perimeter(*outer, -0.030),
            ],
            ["enamel", "rubber", "glass", "glass", "invisible", "rubber", "headliner", "enamel"],
            wrap=True,
        )
        for u0 in (-0.54, 0.36):
            # Arms on the lower frit, blades parked across the glass.
            arm = point(u0 + 0.13, 0.012, 0.016)
            elbow = point(u0 - 0.09, 0.049, 0.012)
            blade_end = point(u0 + 0.29, 0.062, 0.012)
            self.rod("wiper arm", arm, elbow, 0.007, "rubber", 8)
            self.rod("wiper blade", point(u0 - 0.26, 0.044, 0.012), blade_end, 0.007, "rubber", 8)
        self.box(
            "interior mirror",
            (-0.133, self.top(self.roof_front) - 0.136, self.roof_front + 0.030),
            (0.133, self.top(self.roof_front) - 0.068, self.roof_front + 0.088),
            "rubber",
            0.014,
        )

    def facepoint(self, sg, z, x, y, off):
        # Nose and tail in plan view, wrapping both fasciae through the quarter panels.
        width = self.side(1, z, y)[0]
        t = abs(x / max(width, 0.2))
        roundness = 1 - min(t, 1) ** 3
        zz = self.side(1, z, y)[2]
        if sg > 0:
            y += (0.034 if self.cargo else 0.098) * roundness * (y / max(self.belt(z), 0.1)) ** 3
        zz += sg * ((0.216 if sg > 0 and not self.cargo else 0.070) * roundness + off)
        return (x, y, zz)

    def end_panel(self, name, sg, z, u0, u1, y0, y1, tag, inner="under", off=0, depth=0.045):
        us = samples(u0, u1, max(1, math.ceil(abs(u1 - u0) * 3)))
        bumper = name == "impact beam" and not self.cargo
        ys = [y0, lerp(y0, y1, 0.16), lerp(y0, y1, 0.73), y1] if bumper else samples(y0, y1, max(1, math.ceil((y1 - y0) * 3)))
        out = []
        back = []
        for y in ys:
            w = self.side(1, z, y)[0]

            def row(depth_offset):
                points = []
                for u in us:
                    yy = y
                    uu = u
                    face_offset = depth_offset
                    q = (y - y0) / (y1 - y0)
                    if bumper:
                        face_offset -= curve([(0, 0.056), (0.16, 0.012), (0.73, 0), (1, 0.022)], q)
                        yy += 0.034 * (abs(u) ** 3.4) * (1 - q)
                        uu *= 1 - 0.026 * (1 - q)
                    if (
                        not self.cargo
                        and sg > 0
                        and name in {"lower air pocket", "lower bright accent", "upper grille", "bright grille wing"}
                    ):
                        uu *= 0.88 + 0.12 * q if "lower" in name else 1 - 0.06 * q
                    if not self.cargo and sg > 0:
                        if y0 >= 0.62:
                            yy += 0.057 * (abs(u) ** 1.8)
                        elif "intake" in name or "bright accent" in name:
                            yy += 0.016 * abs(u)
                    points.append(self.facepoint(sg, z, uu * w, yy, face_offset))
                return points

            out.append(row(off))
            back.append(row(off - depth))
        self.patch(name, out, back, tag, inner, tag)

    def fascia(self):
        z = self.nose
        belt = self.belt(z)
        self.end_panel("front mask", 1, z, -1, 1, self.bottom + 0.042, belt, "enamel")
        self.end_panel(
            "impact beam",
            1,
            z - 0.034,
            -1.013,
            1.013,
            self.bottom - 0.05,
            self.bottom + 0.20,
            "rubstrip" if self.cargo else "enamel",
            off=0.046,
            depth=0.18,
        )

        def trim(name, us, ys, tag, outer=0.025, dep=0.018):
            self.end_panel(name, 1, z, *us, *ys, tag, off=outer, depth=dep)

        if self.cargo:
            # Broad black radiator mask and rectangular twin reflectors within stepped amber corners.
            trim("upper grille", (-0.47, 0.47), (0.69, 0.944), "grille")
            for y in (0.722, 0.785, 0.850, 0.915):
                trim("grille blade", (-0.452, 0.452), (y, y + 0.017), "rubstrip", 0.039)
            trim("lower intake", (-0.62, 0.62), (0.471, 0.566), "grille", 0.034)
            for s in (1, -1):
                for name, a, b, lo, hi, t, o in [
                    ("lamp seal", 0.495, 0.949, 0.758, 0.973, "seam", 0.023),
                    ("reflector", 0.513, 0.864, 0.788, 0.954, "headlamp", 0.036),
                    ("indicator", 0.873, 0.934, 0.785, 0.949, "amber", 0.037),
                    ("reflector divider", 0.675, 0.693, 0.802, 0.945, "chrome", 0.045),
                    ("bumper marker", 0.80, 0.919, 0.487, 0.535, "amber", 0.041),
                ]:
                    trim(name, (a * s, b * s), (lo, hi), t, o)
        else:
            trim("upper grille", (-0.53, 0.53), (0.634, 0.731), "grille")
            trim("bright grille wing", (-0.536, 0.536), (0.718, 0.737), "chrome", 0.042)
            trim("lower air pocket", (-0.70, 0.70), (0.349, 0.503), "grille", 0.043)
            trim("lower bright accent", (-0.609, 0.609), (0.356, 0.370), "chrome", 0.052)
            for side in (1, -1):
                self.touring_lamp(side)
                trim("fog surround", (0.774 * side, 0.944 * side), (0.382, 0.468), "seam", 0.036)
                trim("fog light", (0.800 * side, 0.899 * side), (0.399, 0.441), "reverse", 0.044)
        trim("maker emblem", (-0.059, 0.059), (0.778, 0.850) if self.cargo else (0.658, 0.724), "badge", 0.052)
        trim("registration", (-0.197, 0.197), (0.463, 0.562) if self.cargo else (0.407, 0.492), "plate", 0.058)
        # Faceted wrapping end caps connect the visible front bumper to both wings.
        for sg in (1, -1):
            self.side_band(
                "nose corner",
                sg,
                self.nose - 0.18,
                self.nose - 0.005,
                lambda z: (self.bottom + 0.014, self.bottom + 0.155),
                "rubstrip" if self.cargo else "lower",
                0.003,
            )

    def touring_lamp(self, sg):
        # An unbroken lens and seal turn the nose's shoulder, narrowing at the fender tip.
        # The first two thirds follow the fascia; the last third returns down the side pressing.
        def location(t, v, off):
            low = curve([(0, 0.649), (0.35, 0.667), (0.68, 0.698), (0.87, 0.738), (1, 0.791)], t)
            high = curve([(0, 0.739), (0.35, 0.776), (0.68, 0.809), (0.87, 0.828), (1, 0.845)], t)
            yy = lerp(low, high, v)
            if t <= 0.68:
                u = lerp(0.518, 1, t / 0.68)
                w = self.side(1, self.nose, yy)[0]
                x, y, z = self.facepoint(1, self.nose, sg * u * w, yy, off * (1 - u * 0.65))
                return (x + sg * off * u * u, y, z)
            z = self.nose - 0.277 * (t - 0.68) / 0.32
            x, y, zz = self.side(sg, z, yy, off)
            return (x, y, zz + 0.35 * off * max(0, 1 - (t - 0.68) / 0.32))

        def optics(name, a, b, lo, hi, offset, tag):
            stations = sorted(set(samples(a, b, max(2, math.ceil((b - a) * 17))) + [v for v in (0.35, 0.68, 0.87) if a < v < b]))
            outside = [[location(t, v, offset) for v in (lo, hi)] for t in stations]
            inner = [[location(t, v, offset - 0.010) for v in (lo, hi)] for t in stations]
            self.patch(name, outside, inner, tag, tag, tag)

        optics("headlight seal", 0, 1, 0, 1, 0.019, "seam")
        optics("headlight optic", 0.018, 0.811, 0.105, 0.835, 0.032, "headlamp")
        optics("outboard amber optic", 0.815, 0.967, 0.123, 0.826, 0.032, "amber")
        optics("upper reflector strip", 0.016, 0.973, 0.846, 0.943, 0.034, "chrome")
        optics("reflector separator", 0.39, 0.407, 0.14, 0.79, 0.037, "chrome")

    def tail(self):
        z = self.rear
        belt = self.belt(z)
        self.end_panel("tailgate skin", -1, z, -1, 1, self.bottom + 0.043, belt + 0.034, "enamel", inner="doorcard")
        self.end_panel(
            "rear impact beam",
            -1,
            z + 0.014,
            -1.01,
            1.01,
            self.bottom - 0.043,
            self.bottom + 0.191,
            "rubstrip" if self.cargo else "lower",
            off=0.059,
            depth=0.16,
        )

        def tailpatch(name, u, v, y0, y1, tag, off=0.022):
            self.end_panel(name, -1, z, u, v, y0, y1, tag, inner="lining", off=off, depth=0.027)

        top = self.top(z)
        for s in (1, -1):
            if self.cargo:
                tailpatch("upper rear door", s * 0.008, s * 0.995, belt + 0.015, top + 0.012, "enamel", 0.004)
                tailpatch("blind top pressing", s * 0.067, s * 0.845, belt + 0.105, top - 0.101, "pressed", 0.022)
                tailpatch("lower rear pressing", s * 0.065, s * 0.806, self.bottom + 0.292, belt - 0.104, "rearpress", 0.021)
                tailpatch("tail light gasket", s * 0.852, s * 0.988, 0.67, 1.41, "seam", 0.042)
                for y0, y1, t in [
                    (0.696, 0.923, "redlamp"),
                    (0.937, 1.025, "reverse"),
                    (1.041, 1.124, "amber"),
                    (1.141, 1.381, "redlamp"),
                ]:
                    tailpatch("segmented rear lamp", s * 0.870, s * 0.976, y0, y1, t, 0.054)
                for y in (0.74, 1.95):
                    tailpatch("rear hinge", s * 0.785, s * 0.909, y, y + 0.062, "steel", 0.052)
            else:
                tailpatch("rear light housing", s * 0.631, s * 0.988, 1.013, 1.156, "seam", 0.040)
                tailpatch("red tail wing", s * 0.645, s * 0.976, 1.036, 1.140, "redlamp", 0.050)
                tailpatch("reversing optic", s * 0.677, s * 0.79, 1.047, 1.084, "reverse", 0.062)
            tailpatch("bumper reflector", s * 0.759, s * 0.914, self.bottom + 0.017, self.bottom + 0.065, "redlamp", 0.073)
        # The solid header closes the compound-curved roof crown over the rear opening.
        outer = []
        for t in (0, 0.22, 0.68, 1):
            row = []
            for u in samples(-1, 1, 12):
                x, y, zz = self.cap_point(self.roof_end + 0.023, u, "roof")
                rear_x, rear_y, rear_z = self.facepoint(-1, z, u * self.side(1, z, top)[0], top + 0.014, 0.022)
                row.append((lerp(rear_x, x, t), lerp(rear_y, y, t) + 0.010 * math.sin(t * math.pi), lerp(rear_z, zz, t)))
            outer.append(row)
        self.patch(
            "rear roof hem", outer, [[(x, y - 0.046, zz) for x, y, zz in row] for row in outer], "enamel", "headliner", "enamel"
        )
        if self.cargo:
            tailpatch("barn door joint", -0.008, 0.008, self.bottom + 0.155, top - 0.035, "seam", 0.028)
            tailpatch("latch", -0.133, -0.031, 1.04, 1.124, "rubstrip", 0.053)
        else:
            self.end_panel("bonded hatch glass", -1, z, -1, 1, belt + 0.020, top + 0.020, "glass", "invisible", 0.004)
            for x in (-0.976, 0.976):
                tailpatch("rear glass seal", x - 0.016, x + 0.016, belt - 0.002, top, "rubber", 0.015)
            tailpatch("rear glass lower seal", -0.99, 0.99, belt + 0.006, belt + 0.033, "rubber", 0.018)
            tailpatch("hatch lip", -0.996, 0.996, top - 0.013, top + 0.057, "enamel", 0.037)
            tailpatch("liftgate garnish", -0.63, 0.63, 0.941, 0.971, "chrome", 0.032)
            tailpatch("liftgate release", -0.104, 0.104, 0.900, 0.939, "rubstrip", 0.041)
            a = self.facepoint(-1, z, 0.10, belt + 0.085, 0.037)
            b = self.facepoint(-1, z, -0.46, belt + 0.115, 0.040)
            self.rod("rear wiper", a, b, 0.010, "rubber", 8)
        tailpatch("high stop light", -0.153, 0.153, top - 0.015, top + 0.017, "redlamp", 0.052)
        tailpatch("plate plinth", -0.257, 0.257, 0.647, 0.838, "seam", 0.039)
        tailpatch("plate", -0.225, 0.225, 0.667, 0.816, "plate", 0.051)

    def wheels(self):
        d = self.dimensions
        for end, z in (("front", d.halfWheelbase), ("rear", -d.halfWheelbase)):
            for side, sg in (("left", 1), ("right", -1)):
                self.bone = f"wheel_{end}_{side}"
                c = (sg * d.halfTrack, d.wheelRadius, z)
                r, w = d.wheelRadius, d.wheelWidth * 0.5
                tire = [
                    (-w * 0.86, r * 0.59),
                    (-w, r * 0.71),
                    (-w * 0.99, r * 0.82),
                    (-w * 0.92, r * 0.93),
                    (-w * 0.78, r * 0.986),
                    (-w * 0.60, r),
                    (w * 0.60, r),
                    (w * 0.78, r * 0.986),
                    (w * 0.92, r * 0.93),
                    (w * 0.99, r * 0.82),
                    (w, r * 0.71),
                    (w * 0.86, r * 0.59),
                ]
                self.lathe("tire", c, sg, tire, 36, lambda k: "tread" if 4 <= k <= 6 else "rubber")
                self.lathe(
                    "rim lip",
                    c,
                    sg,
                    [
                        (w * 0.86, r * 0.555),
                        (w * 0.985, r * 0.585),
                        (w * 0.991, r * 0.623),
                        (w * 0.91, r * 0.643),
                        (w * 0.78, r * 0.620),
                        (-w * 0.81, r * 0.611),
                        (-w * 0.82, r * 0.553),
                    ],
                    32,
                    "rim",
                )
                self.rod("brake rotor", (c[0] + sg * w * 0.12, c[1], z), (c[0] + sg * w * 0.27, c[1], z), r * 0.519, "steel", 28)
                # One dished metal pressing, pierced by eight ventilation slots on the work van. The family
                # casting opens these into long trapezoids and sweeps the spokes back at the rim.
                sectors = 8 if self.cargo else 6
                radii = [0.125, 0.274 if self.cargo else 0.222, 0.437 if self.cargo else 0.498, 0.565, 0.604]
                depths = [0.962, 0.939, 0.888, 0.829, 0.886]
                p = Part()
                indices = {}

                def vertex(layer, k, j):
                    key = layer, k % (sectors * 6), j
                    if key not in indices:
                        angle = 2 * math.pi * k / (sectors * 6) + (radii[j] ** 1.5) * (0.23 if self.cargo else 0.81)
                        rad = r * radii[j]
                        indices[key] = p.v(
                            (c[0] + sg * w * (depths[j] - 0.205 * layer), c[1] + rad * math.cos(angle), z + rad * math.sin(angle))
                        )
                    return indices[key]

                tiles = {
                    (k, j)
                    for k in range(sectors * 6)
                    for j in range(4)
                    if not (j == 1 and k % 6 in ((1, 2, 3) if self.cargo else (1, 2, 3, 4)))
                }
                for k, j in sorted(tiles):
                    corners = [(k, j), (k + 1, j), (k + 1, j + 1), (k, j + 1)]
                    for layer in (0, 1):
                        p.face([vertex(layer, *v) for v in corners], "rim" if not layer else "steel")
                    neighbours = [(k, j - 1), ((k + 1) % (sectors * 6), j), (k, j + 1), ((k - 1) % (sectors * 6), j)]
                    for n, (v0, v1) in enumerate(zip(corners, corners[1:] + corners[:1])):
                        if neighbours[n] not in tiles:
                            p.face([vertex(0, *v0), vertex(0, *v1), vertex(1, *v1), vertex(1, *v0)], "hub")
                self.add(p.obj("perforated steel" if self.cargo else "touring alloy"))
                self.rod(
                    "hub cap",
                    (c[0] + sg * w * 0.87, c[1], z),
                    (c[0] + sg * w * 0.995, c[1], z),
                    r * 0.167,
                    "hub" if self.cargo else "rim",
                    20,
                    r * 0.146,
                )
                for n in range(5):
                    a = n * 2 * math.pi / 5
                    y, z1 = c[1] + r * 0.206 * math.cos(a), z + r * 0.206 * math.sin(a)
                    self.rod("lug", (c[0] + sg * w * 0.922, y, z1), (c[0] + sg * w * 0.995, y, z1), 0.012, "steel", 6)
        self.bone = "chassis"

    def seat(self, x, y, z):
        # Pelvis is just above the cushion and in front of the squab. Leave the entire footwell open forward.
        self.box("seat riser", (x - 0.195, self.floor, z - 0.26), (x + 0.195, y - 0.151, z + 0.22), "dash", 0.039)
        self.box("cushion", (x - 0.249, y - 0.159, z - 0.25), (x + 0.249, y - 0.039, z + 0.31), "bolster", 0.051, 3)
        self.box("inset cloth", (x - 0.19, y - 0.086, z - 0.207), (x + 0.19, y - 0.032, z + 0.25), "fabric", 0.027)
        for s in (1, -1):
            self.box(
                "cushion bolster", (x + s * 0.185, y - 0.106, z - 0.203), (x + s * 0.250, y + 0.004, z + 0.229), "bolster", 0.037
            )
        low = z - 0.27
        high = z - 0.353

        def reclined(name, xw, y0, y1, front, rear, tag):
            rings = []
            for t, w in ((0, 0.91), (0.055, 0.986), (0.58, 1.0), (0.875, 0.94), (1.0, 0.81)):
                zz = lerp(low, high, t)
                x0 = xw * w
                crown = 0.014 * math.sin(t * math.pi)
                rings.append(
                    [
                        (x + u * x0, lerp(y0, y1, t), zz + v)
                        for u, v in (
                            (-1, front - 0.024),
                            (-0.89, front),
                            (-0.42, front + crown),
                            (0.42, front + crown),
                            (0.89, front),
                            (1, front - 0.024),
                            (1, rear + 0.020),
                            (0.86, rear),
                            (-0.86, rear),
                            (-1, rear + 0.020),
                        )
                    ]
                )
            self.ring(name, rings, tag)

        reclined("moulded seat back", 0.247, y - 0.085, y + 0.451, 0.038, -0.072, "bolster")
        # The textured insert lies into the front face with soft returns along the side bolsters.
        reclined("seat back insert", 0.181, y - 0.012, y + 0.401, 0.057, 0.019, "fabric")
        for a in (-0.09, 0.09):
            self.rod("headrest post", (x + a, y + 0.421, high - 0.023), (x + a, y + 0.535, high - 0.025), 0.010, "aluminium", 8)
        self.box("headrest", (x - 0.137, y + 0.510, high - 0.099), (x + 0.137, y + 0.682, high + 0.019), "bolster", 0.035)
        buckle = x - math.copysign(0.284, x)
        self.box("belt buckle", (buckle - 0.020, y - 0.054, z - 0.046), (buckle + 0.020, y + 0.040, z + 0.012), "belt", 0.012)
        self.box("release", (buckle - 0.017, y + 0.027, z - 0.044), (buckle + 0.017, y + 0.045, z + 0.005), "latch", 0.006)

    def cabin(self):
        d = self.dimensions
        self.box(
            "floor pan",
            (-d.bodyHalf + 0.067, self.floor - 0.085, self.rear + 0.04),
            (d.bodyHalf - 0.067, self.floor, self.cowl + 0.23),
            "floor" if self.cargo else "carpet",
            0.03,
        )
        # Central chassis sits between the wheel tracks. Engine and undertray are ahead of the footwell.
        self.box(
            "undertray",
            (-0.64, self.bottom - 0.152, self.rear + 0.18),
            (0.64, self.floor - 0.041, self.nose - 0.53),
            "under",
            0.045,
        )
        self.box(
            "scuttle",
            (-0.67, self.floor - 0.015, self.cowl + 0.047),
            (0.67, self.belt(self.nose) - 0.115, self.nose - 0.370),
            "under",
            0.075,
            3,
        )
        z = d.steeringZ + 0.125
        self.box(
            "fascia",
            (-d.bodyHalf + 0.074, d.steeringY - 0.195, z),
            (d.bodyHalf - 0.074, d.beltline - 0.084, self.cowl + 0.045),
            "dash",
            0.049,
            3,
        )
        self.box(
            "instrument binnacle",
            (d.seatX - 0.225, d.steeringY - 0.014, z - 0.024),
            (d.seatX + 0.225, d.steeringY + 0.127, self.cowl - 0.032),
            "dash",
            0.055,
            3,
        )
        self.box(
            "instrument face",
            (d.seatX - 0.181, d.steeringY + 0.018, z - 0.035),
            (d.seatX + 0.181, d.steeringY + 0.098, z - 0.019),
            "gauges",
            0.009,
        )
        self.box("centre stack", (-0.151, self.floor + 0.040, z - 0.012), (0.151, d.steeringY + 0.028, z + 0.133), "dash", 0.020)
        self.box("radio", (-0.119, d.steeringY - 0.096, z - 0.033), (0.119, d.steeringY + 0.013, z - 0.015), "radio", 0.008)
        for x in (-0.70, -0.155, 0.10, 0.71):
            self.box(
                "air register",
                (x - 0.055, d.steeringY + 0.011, z - 0.010),
                (x + 0.055, d.steeringY + 0.064, z + 0.018),
                "vent",
                0.009,
            )
        self.rod(
            "steering column", (d.seatX, d.steeringY - 0.092, z + 0.034), (d.seatX, d.steeringY, d.steeringZ), 0.031, "dash", 12
        )
        self.bone = "steering_wheel"
        cx, cy, cz = self.joints[self.bone]
        # Wheel in the XY plane to match its spin axis in the vehicle definition.
        p = Part()
        lathe(
            p,
            (0, 0, 0),
            1,
            [(-0.018, 0.168), (-0.012, 0.185), (0.007, 0.193), (0.019, 0.182), (0.019, 0.163), (0.006, 0.152), (-0.010, 0.154)],
            28,
            "rubber",
        )
        wheel = p.obj("steering rim")
        for v in wheel.data.vertices:
            ob = v.co.copy()
            v.co = (cx + ob.z, cy + ob.y, cz - ob.x)
        self.add(wheel)
        self.box("horn pad", (cx - 0.066, cy - 0.061, cz - 0.023), (cx + 0.066, cy + 0.054, cz + 0.021), "dash", 0.022)
        for dx, dy in ((-0.158, 0.055), (0.158, 0.055), (0, -0.170)):
            self.rod("steering spoke", (cx, cy, cz), (cx + dx, cy + dy, cz), 0.017, "dash", 8)
        self.bone = "chassis"
        for dx in (-0.11, 0.077):
            self.box(
                "pedal",
                (d.seatX + dx - 0.033, self.floor + 0.032, z + 0.034),
                (d.seatX + dx + 0.033, self.floor + 0.124, z + 0.068),
                "brake",
                0.009,
            )
        for s in (1, -1):
            self.seat(s * d.seatX, d.seatY, d.seatZ)
        if self.cargo:
            # An actual hollow load bay with boarded wall liners, tie-down rails, bulkhead and a fluted load floor.
            cargo_end = 0.283
            self.box(
                "steel bulkhead",
                (-0.904, self.floor - 0.013, cargo_end - 0.034),
                (0.904, 2.021, cargo_end + 0.006),
                "lining",
                0.025,
            )
            self.box("bulkhead window seal", (-0.39, 1.406, cargo_end + 0.004), (0.39, 1.764, cargo_end + 0.018), "rubber", 0.012)
            self.box("safety window", (-0.361, 1.427, cargo_end + 0.015), (0.361, 1.741, cargo_end + 0.027), "glass", 0.014)
            for x in (-0.278, -0.14, 0, 0.14, 0.278):
                self.box(
                    "protective bars",
                    (x - 0.008, 1.426, cargo_end + 0.021),
                    (x + 0.008, 1.741, cargo_end + 0.036),
                    "steel",
                    0.005,
                )
            for x in (-0.78, -0.39, 0, 0.39, 0.78):
                self.box(
                    "bulkhead rib",
                    (x - 0.018, self.floor + 0.075, cargo_end - 0.065),
                    (x + 0.018, 1.26, cargo_end - 0.032),
                    "lining",
                    0.011,
                )
            for x in (-0.66, -0.44, -0.22, 0, 0.22, 0.44, 0.66):
                self.box(
                    "load floor rib",
                    (x - 0.012, self.floor - 0.002, self.rear + 0.14),
                    (x + 0.012, self.floor + 0.010, 0.20),
                    "aluminium",
                    0.005,
                )
            for sg in (1, -1):
                self.box(
                    "inner wheelhouse",
                    (sg * 0.641, self.floor, -d.halfWheelbase - 0.429),
                    (sg * 0.932, d.wheelRadius * 2 + 0.124, -d.halfWheelbase + 0.428),
                    "lining",
                    0.058,
                    3,
                )
                for z in (-2.25, -1.82, -1.33, -0.78, -0.22):
                    # On the sliding leaf, the wear board and lashing rail travel with the door.
                    self.bone = "door_slide_right" if sg == -1 and -1.1 < z < 0.18 else "chassis"
                    x = sg * 0.915
                    self.box("load rail", (x - sg * 0.025, 1.099, z - 0.16), (x, 1.149, z + 0.16), "aluminium", 0.008)
                    self.box("rail slot", (x - sg * 0.032, 1.108, z - 0.06), (x - sg * 0.023, 1.137, z + 0.06), "seam", 0.006)
            self.bone = "chassis"
        else:
            for s in (1, -1):
                self.seat(s * d.seatX, d.seatY, d.slideZ)
                self.box(
                    "rear wheelhouse",
                    (s * 0.663, self.floor, -d.halfWheelbase - 0.365),
                    (s * 0.902, 0.665, -d.halfWheelbase + 0.355),
                    "doorcard",
                    0.075,
                    3,
                )
                self.box(
                    "rear stowage pocket",
                    (s * 0.632, 0.575, -d.halfWheelbase - 0.220),
                    (s * 0.814, 0.691, -d.halfWheelbase + 0.182),
                    "carpet",
                    0.030,
                )
                for z0 in (d.seatZ, d.slideZ):
                    self.rod(
                        "shoulder web",
                        (s * 0.805, self.top(z0 - 0.41) - 0.125, z0 - 0.403),
                        (s * 0.707, d.seatY - 0.048, z0 - 0.224),
                        0.017,
                        "belt",
                        6,
                    )
        for z0 in (-1.57, -0.37, 0.275):
            y = self.top(z0)
            self.box("courtesy lamp", (-0.082, y - 0.029, z0 - 0.063), (0.082, y + 0.015, z0 + 0.063), "lamp", 0.014)
        yc = d.wheelRadius * 0.73
        self.rod("tail pipe", (0.56, yc, self.rear + 0.203), (0.56, yc, -d.halfLength + 0.052), 0.035, "steel", 14)
        self.rod("tail pipe bore", (0.56, yc, -d.halfLength + 0.052), (0.56, yc, -d.halfLength + 0.049), 0.027, "under", 14)

    def finish(self):
        arm = bpy.data.armatures.new(self.kind)
        rig = bpy.data.objects.new(self.kind, arm)
        bpy.context.scene.collection.objects.link(rig)
        bpy.context.view_layer.objects.active = rig
        bpy.ops.object.mode_set(mode="EDIT")
        for name, (x, y, z) in self.joints.items():
            bone = arm.edit_bones.new(name)
            bone.head = (x, -z, y)
            bone.tail = (x, -z, y + 0.1)
            if name != "chassis":
                bone.parent = arm.edit_bones["chassis"]
        bpy.ops.object.mode_set(mode="OBJECT")
        mats = {m: bpy.data.materials.new(m) for m in ("coach", "fittings", "cabin")}
        for bone, o in self.objects:
            mesh = o.data
            bm = bmesh.new()
            bm.from_mesh(mesh)
            bmesh.ops.triangulate(bm, faces=list(bm.faces))
            bm.to_mesh(mesh)
            bm.free()
            tags = tags_of(o)
            mesh.materials.clear()
            for m in mats.values():
                mesh.materials.append(m)
            uv = mesh.uv_layers.new(name="atlas")
            xs = [v.co.copy() for v in mesh.vertices]
            low = [min(v[k] for v in xs) for k in range(3)]
            span = [max(v[k] for v in xs) - low[k] for k in range(3)]
            for poly, tag in zip(mesh.polygons, tags):
                mat, idx = TILE[tag]
                poly.material_index = list(mats).index(mat)
                poly.use_smooth = True
                normal = poly.normal
                axis = max(range(3), key=lambda k: abs(normal[k]))
                # Exterior plates and dials read upright from either end. Roof grain runs along the vehicle.
                a, b = [(2, 1), (0, 2), (0, 1)][axis]
                for j in poly.loop_indices:
                    pos = xs[mesh.loops[j].vertex_index]
                    u = (pos[a] - low[a]) / max(span[a], 0.001)
                    v = (pos[b] - low[b]) / max(span[b], 0.001)
                    if (axis == 2 and normal.z < 0) or (axis == 0 and normal.x > 0):
                        u = 1 - u
                    uv.data[j].uv = ((idx % 4 + 0.035 + 0.93 * u) / 4, 1 - (idx // 4 + 0.965 - 0.93 * v) / 4)
            mesh.set_sharp_from_angle(angle=math.radians(39))
            mesh.transform(E2B)
            vg = o.vertex_groups.new(name=bone)
            vg.add(list(range(len(mesh.vertices))), 1.0, "REPLACE")
            o.parent = rig
            o.modifiers.new("Armature", "ARMATURE").object = rig
        # Export a single draw mesh; the joints and atlas coordinates survive the join.
        bpy.ops.object.select_all(action="DESELECT")
        for bone, o in self.objects:
            o.select_set(True)
        bpy.context.view_layer.objects.active = self.objects[0][1]
        bpy.ops.object.join()
        bpy.context.object.name = self.kind + "_skin"


def build(kind):
    values = json.loads((HERE.parents[4] / "content/vehicles/van-dimensions.json").read_text())[kind]
    coach = Coach(kind, SimpleNamespace(**values))
    coach.sides()
    coach.roof_and_hood()
    coach.windshield()
    coach.fascia()
    coach.tail()
    coach.wheels()
    coach.cabin()
    coach.finish()
