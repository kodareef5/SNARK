"""Refit the downloaded rigid road shells. All measurements are in SNARK metres (+Z forward)."""

import gzip
import json
from pathlib import Path
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont
import fast_simplification
from manifold3d import Manifold, Mesh64, CrossSection
from donor import read_parts
from distance import shell

HERE = Path(__file__).resolve().parent
RAW = HERE.parents[3] / "raw" / "grab3d"

# Component IDs refer to welded islands of the archived body. Remove the donor's high
# display seats and controls so the playable occupants sit below the roof.
MODELS = {
    "monster_truck": dict(
        body=3,
        roof=7,
        floor=1.33,
        sill=1.89,
        width=0.76,
        cabin=(-0.89, 0.24),
        doors=[(-0.79, 0.24)],
        driver=(0.42, 1.64, -0.46),
        remove={14, 19, 21, 22, 41, 42, 44, 45, 46, 47, 50, 51},
        colors={
            0: {3, 7},
            1: {4, 65},
            2: {0, 1, 25, 26, 27, 28, 31, 37, 38, 39, 40, 52},
            3: {2, 5, 6, 9, 10, 12, 13, 17, 18, 32, 33, 34, 56, 57, 61, 62, 63, 64, 66},
            7: {11, 24, 35, 43, 53, 54},
            8: {8, 58},
            9: {36},
        },
        paint=(43, 113, 116),
        accent=(237, 163, 55),
    ),
    "muscle_car": dict(
        body=1,
        roof=6,
        floor=0.33,
        sill=0.90,
        width=0.83,
        cabin=(-1.28, 0.47),
        doors=[(-0.66, 0.48)],
        driver=(0.42, 0.59, -0.30),
        remove={10, 12, 13, 14, 32, 33, 35, 36, 37, 38, 39, 41},
        colors={
            0: {1, 6, 9, 22},
            1: {23, 24, 25, 29, 30, 31},
            2: {8, 15, 16, 17, 26},
            3: {0, 2, 3, 4, 5, 18, 20, 21, 42, 44, 45, 46},
            7: {11, 19, 40, 43},
            8: {7, 34},
            9: {27, 28},
        },
        paint=(147, 56, 37),
        accent=(231, 211, 166),
    ),
    "taxi": dict(
        body=1,
        roof=46,
        floor=0.34,
        sill=0.96,
        width=0.84,
        cabin=(-1.33, 0.77),
        doors=[(-0.26, 0.78), (-1.22, -0.28)],
        driver=(0.42, 0.63, 0.16),
        remove=set(range(4, 44)) | set(range(71, 111)) | set(range(58, 66)),
        colors={
            0: {1, 46},
            1: {51},
            2: {2, 3, 49, 50, 52, 53},
            3: {0, 44, 45, 54, 55, 68, 69, 70},
            7: {48, 66},
            8: {47, 67},
            9: {56, 57},
        },
        paint=(228, 159, 43),
        accent=(242, 220, 163),
    ),
}


def block(lo, hi):
    lo, hi = np.array(lo), np.array(hi)
    return Manifold.cube(hi - lo).translate(lo)


def box(at, size):
    return Manifold.cube(size, True).translate(at)


def bounds(m):
    v = np.array(m.bounding_box()).reshape(2, 3)
    return v.mean(0), v[1] - v[0]


def palette(name, cfg, out):
    colors = [
        cfg["paint"],
        cfg["accent"],
        (43, 48, 49),
        (159, 167, 163),
        (35, 37, 38),
        (77, 79, 75),
        (75, 65, 54),
        (246, 222, 170),
        (183, 53, 43),
        (205, 194, 157),
        (103, 80, 56),
        (52, 62, 61),
        cfg["paint"],
        cfg["paint"],
        cfg["accent"],
        (49, 51, 50),
    ]
    atlas = Image.new("RGB", (1024, 1024))
    rng = np.random.default_rng(62)
    fontfile = next(
        p
        for p in [
            "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        ]
        if Path(p).exists()
    )
    for i, c in enumerate(colors):
        patch = Image.fromarray(
            np.clip(
                np.array(c) + rng.normal(0, 1.5, (256, 256, 1)) + np.linspace(2, -2, 256)[:, None, None],
                0,
                255,
            ).astype("uint8")
        )
        d = ImageDraw.Draw(patch)
        if i == 12:
            if name == "taxi":
                for col in range(16):
                    for row in range(2):
                        d.rectangle(
                            (col * 16, 32 + row * 94, (col + 1) * 16, 32 + (row + 1) * 94),
                            fill=colors[2 if (col + row) % 2 else 1],
                        )
            else:
                # Slanted gold bars applied to the pickup's flanks.
                for x in [52, 110, 168]:
                    d.polygon([(x, 30), (x + 31, 30), (x - 12, 226), (x - 43, 226)], fill=colors[1])
        if i in [13, 14]:
            word = (
                {"monster_truck": "07", "muscle_car": "GT", "taxi": "CITY CAB"}[name] if i == 13 else "TAXI"
            )
            font = ImageFont.truetype(str(fontfile), 50)
            mask = Image.new("L", (256, 100))
            md = ImageDraw.Draw(mask)
            md.text((128, 50), word, font=font, anchor="mm", fill=255)
            crop = mask.crop(mask.getbbox()).resize((207, 168), Image.Resampling.LANCZOS)
            patch.paste(colors[2] if name == "taxi" or i == 14 else colors[1], (24, 43, 231, 211), crop)
        if i == 15:
            for x, r in [(57, 32), (128, 41), (200, 32)]:
                d.ellipse((x - r, 128 - r, x + r, 128 + r), fill=colors[2], outline=colors[3], width=5)
                d.line((x, 128, x - r * 0.5, 128 - r * 0.5), fill=colors[1], width=4)
        atlas.paste(patch, (i % 4 * 256, i // 4 * 256))
    atlas.save(out / "livery.png")
    orm = Image.new("RGB", atlas.size, (255, 159, 26))
    d = ImageDraw.Draw(orm)
    for i, ormcolor in [(0, (255, 122, 68)), (3, (255, 94, 174)), (4, (255, 214, 8)), (6, (255, 202, 6))]:
        x, y = i % 4 * 256, i // 4 * 256
        d.rectangle((x, y, x + 255, y + 255), fill=ormcolor)
    orm.save(out / "orm.png")
    (out / "palette.json").write_text(json.dumps(colors))


def make(name):
    cfg = MODELS[name]
    truck = name == "monster_truck"
    taxi = name == "taxi"
    out = HERE.parent / name
    out.mkdir(exist_ok=True)
    raw = RAW / (name.replace("_", "-") + ".glb")
    src, pivots = read_parts(raw)
    body = src["body"][cfg["body"]][1]
    roof = src["body"][cfg["roof"]][1]
    floor = cfg["floor"]
    sill = cfg["sill"]
    width = cfg["width"]
    aft, front = cfg["cabin"]
    parts = []
    rig = {"chassis": [0, 0, 0]}

    def add(m, tile, bone="chassis", last=5):
        if not m.is_empty() and m.volume() > 1e-10:
            parts.append((m, tile, bone, last))

    def panel(at, size, tile, bone="chassis", last=5):
        add(box(at, size), tile, bone, last)

    # Retain original compound curvature and fitted wheel arches. Hollow the
    # seats' footwell, then remove actual door slabs from the two side walls.
    body -= block((-width + 0.11, floor, aft), (width - 0.11, 3, front))
    if truck:
        body -= block((-0.63, 1.57, -2.02), (0.63, 2.5, -1.02))
        panel((0, 1.573, -1.52), (1.24, 0.024, 0.97), 2)
        for x in np.linspace(-0.54, 0.54, 8):
            panel((x, 1.597, -1.52), (0.034, 0.022, 0.89), 5, last=3)
    if taxi:
        # Keep the stamped crown of the solid display cab. Trace the donor
        # glazing's lower and upper corners to restore the A, B and C pillars.
        roof = roof.trim_by_plane((0, 1, 0), 1.365)
        for sign in [-1, 1]:
            for bottom, top, depth in [(0.89, 0.26, 0.086), (-0.28, -0.28, 0.078), (-1.44, -1.07, 0.13)]:
                ends = [
                    box((sign * x, y, z), (0.09, 0.055, depth))
                    for x, y, z in [(0.729, 0.95, bottom), (0.636, 1.39, top)]
                ]
                add(Manifold.batch_hull(ends), 0)
    door_parts = []
    for row, (back, hinge) in enumerate(cfg["doors"]):
        for sign, side in [(1, "left"), (-1, "right")]:
            bone = "door_" + ("rear_" if row else "") + side
            rig[bone] = [sign * width, sill - 0.15, hinge]
            a, b = sorted([sign * (width - 0.14), sign * 2])
            cutter = block((a, floor + 0.075, back), (b, sill + 0.025, hinge))
            slab = body ^ cutter
            body -= cutter
            # Inset the detached stamping fractionally for a clean shut line.
            center, _ = bounds(slab)
            add(slab.translate(-center).scale([1, 0.985, 0.985]).translate(center), 0, bone)
            door_parts.append((back, hinge, sign, bone))
            panel(
                (sign * (width - 0.092), sill - 0.19, (hinge + back) / 2),
                (0.050, 0.053, (hinge - back) * 0.48),
                6,
                bone,
                3,
            )
    add(body, 0)
    add(roof, 0)

    def mount(x, z):
        return next(
            (
                b
                for back, front, sign, b in door_parts
                if sign * x > 0.55 and back - 0.025 <= z <= front + 0.015
            ),
            "chassis",
        )

    for i, (_, m) in enumerate(src["body"]):
        if i in cfg["remove"] or i in [cfg["body"], cfg["roof"]]:
            continue
        pos, span = bounds(m)
        tile = next((c for c, ids in cfg["colors"].items() if i in ids), 2)
        bone = mount(pos[0], pos[2]) if tile in [0, 3] and pos[1] > sill - 0.24 else "chassis"
        last = 5 if max(span) > 0.85 or tile in [7, 8] else 4 if max(span) > 0.32 else 3
        add(m, tile, bone, last)
    x, y, z = cfg["driver"]

    def seat(x, y, z):
        panel((x, y - 0.07, z), (0.53, 0.13, 0.47), 6)
        add(box((0, 0, 0), (0.52, 0.43, 0.11)).rotate((-9, 0, 0)).translate((x, y + 0.15, z - 0.20)), 6)
        panel((x, y + 0.389, z - 0.24), (0.29, 0.12, 0.10), 6, last=3)
        panel((x, y - 0.19, z), (0.35, 0.13, 0.30), 2, last=2)

    for sign in [-1, 1]:
        seat(sign * x, y, z)
        if taxi:
            seat(sign * x, y - 0.012, -0.78)
    wheel = (x, y + 0.245, z + 0.305)
    rig["steering_wheel"] = list(wheel)
    # Make a tilted, open steering rim and spokes on one shaft in all six levels.
    rim = Manifold.cylinder(0.035, 0.163, 0.163, 32, True) - Manifold.cylinder(0.08, 0.139, 0.139, 32, True)
    add(rim.rotate((-21, 0, 0)).translate(wheel), 4, "steering_wheel")
    panel(wheel, (0.294, 0.029, 0.037), 3, "steering_wheel")
    panel((0, sill - 0.033, front - 0.08), (width * 1.68, 0.13, 0.24), 2)
    panel((x, sill + 0.008, front - 0.202), (0.43, 0.098, 0.024), 15)
    for back, hinge, sign, bone in door_parts:
        mid = (back + hinge) / 2
        # Follow the actual outer door stamping, including its tumblehome.
        door = next(m for m, t, b, l in parts if b == bone and t == 0)
        bb = door.bounding_box()
        edge = bb[3] if sign > 0 else bb[0]
        if taxi or truck:
            panel((edge + sign * 0.005, sill - 0.20, mid), (0.015, 0.094, hinge - back - 0.028), 12, bone, 3)
        if not taxi or back > -0.4:
            panel((edge + sign * 0.009, sill - 0.32, mid), (0.018, 0.12, 0.40 if taxi else 0.25), 13, bone, 3)
    if taxi:
        for sign in [-1, 1]:
            panel((0, 1.641, -0.23 + sign * 0.107), (0.52, 0.149, 0.016), 14, last=4)
    if truck:
        for sign in [-1, 1]:
            for drop in [0.18, 0.46]:
                panel((sign * 0.81, floor - drop, -0.22), (0.22, 0.048, 0.69), 3, last=4)
            for end in [-0.52, 0.08]:
                panel((sign * 0.78, floor - 0.25, end), (0.049, 0.49, 0.055), 2, last=4)
    # The solver uses one tyre radius per chassis. Retain the staggered muscle
    # car widths and fit both rolling diameters to the mean of its donor pair.
    radius = 0.8 if truck else 0.33 if taxi else 0.3425
    wheels = []
    for node, suffix in [
        ("wheel_fl", "front_left"),
        ("wheel_fr", "front_right"),
        ("wheel_rl", "rear_left"),
        ("wheel_rr", "rear_right"),
    ]:
        pivot = np.asarray(pivots[node])
        bone = "wheel_" + suffix
        target = pivot.copy()
        target[1] = radius
        rig[bone] = target.round(6).tolist()
        wheel_width = max(bounds(m)[1][0] for _, m in src[node])
        wheels.append((bone, target, wheel_width))
        for mat, m in src[node]:
            pos, span = bounds(m)
            if mat == 0 and max(span) > radius * 1.45:
                continue
            tile = 4 if mat == 0 else 3 if mat == 1 else 1 if mat == 2 else 2
            last = (
                5
                if max(span) > 0.55 * radius
                and not (mat == 0 and span[1] < 1.45 * radius and span[2] < 1.45 * radius)
                else 3
            )
            m = m.translate(-pivot).scale((1, radius / pivot[1], radius / pivot[1])).translate(target)
            add(m, tile, bone, last)
    palette(name, cfg, out)
    (out / "rig.json").write_text(json.dumps(rig, indent=2) + "\n")
    counts = []
    for level, tol in [(0, 0.00018), (2, 0.005), (3, 0.014), (4, 0.038), (5, 0.083)]:
        records = []
        rolling = []
        for bone, pivot, width in wheels:
            sign = np.sign(pivot[0])
            n = {0: 48, 2: 24, 3: 16, 4: 12, 5: 8}[level]

            def turned(profile, tile):
                solid = CrossSection([np.asarray(profile)]).revolve(n).rotate((0, 90, 0)).translate(pivot)
                if solid.is_empty():
                    raise ValueError("Invalid tyre profile")
                rolling.append((solid, tile, bone, 5))

            r = radius * (0.945 if truck and level < 3 else 1.0)
            rim = radius * (0.51 if truck else 0.58)
            h = width * 0.5
            turned(
                [
                    (rim, -h * 0.86),
                    (r * 0.81, -h),
                    (r * 0.95, -h * 0.78),
                    (r, -h * 0.50),
                    (r, h * 0.50),
                    (r * 0.95, h * 0.78),
                    (r * 0.81, h),
                    (rim, h * 0.86),
                ],
                4,
            )
            # Recess the wheel face behind a bright rolled bead. Keep hub and
            # fasteners proud of it so the wheel's rotation reads against the tyre.
            h0 = sign * h
            turned(
                [
                    (rim * 0.78, h0 * 0.84),
                    (rim * 0.99, h0 * 0.84),
                    (rim * 1.04, h0 * 0.96),
                    (rim * 0.96, h0 * 1.02),
                    (rim * 0.78, h0 * 0.99),
                ][:: int(sign)],
                3,
            )
            face = (
                Manifold.cylinder(0.03, rim * 0.82, rim * 0.82, n, True)
                .rotate((0, 90, 0))
                .translate(pivot + [h0 * 0.88, 0, 0])
            )
            rolling.append((face, 5, bone, 5))
            hub = (
                Manifold.cylinder(0.050, rim * 0.36, rim * 0.32, n, True)
                .rotate((0, 90, 0))
                .translate(pivot + [h0 * 1.01, 0, 0])
            )
            rolling.append((hub, 1, bone, 5))
            if level <= 2:
                for a in np.arange(8 if truck else 5) * np.pi * 2 / (8 if truck else 5):
                    stud = (
                        Manifold.cylinder(0.022, rim * 0.075, rim * 0.075, 6, True)
                        .rotate((0, 90, 0))
                        .translate(pivot + [h0, np.cos(a) * rim * 0.54, np.sin(a) * rim * 0.54])
                    )
                    rolling.append((stud, 3, bone, 5))
        distance_parts = shell(name, cfg, src, wheels, rig) if level == 5 else []
        for index, (m, t, b, last) in enumerate(distance_parts or parts + rolling):
            if distance_parts:
                v = m.to_mesh64()
                records.append(
                    [
                        b,
                        t,
                        v.vert_properties[:, :3].round(6).flatten().tolist(),
                        v.tri_verts.flatten().tolist(),
                    ]
                )
                continue
            if level > last:
                continue
            # Every rigid piece remains a closed mesh. Do not decimate across the hinge.
            center, extent = bounds(m)
            if (
                level >= 4
                and b == "chassis"
                and max(extent) < (0.15 if level == 4 else 0.40)
                and t not in [7, 8]
            ):
                continue
            fitted_wheel = index >= len(parts)
            simplified = m if fitted_wheel or m.num_tri() <= 48 else m.simplify(tol)
            if level >= 2 and not b.startswith("wheel_") and simplified.num_tri() > 48:
                old = simplified.to_mesh64()
                v, f = fast_simplification.simplify(
                    np.array(old.vert_properties)[:, :3].copy(),
                    np.array(old.tri_verts, dtype=np.int32),
                    target_count=max(
                        16, int(simplified.num_tri() * {2: 0.35, 3: 0.18, 4: 0.085, 5: 0.035}[level])
                    ),
                )
                if len(f):
                    trial = Manifold(Mesh64(v, f.astype("uint64")))
                    lo = np.asarray(m.bounding_box()[:3])
                    hi = np.asarray(m.bounding_box()[3:])
                    if (
                        not trial.is_empty()
                        and trial.volume() > 0.25 * m.volume()
                        and np.all(v >= lo - 0.025)
                        and np.all(v <= hi + 0.025)
                    ):
                        simplified = trial
            if level >= 2 and b.startswith("wheel_") and not fitted_wheel:
                if t == 4 and max(extent) < radius * 1.45 and level >= 3:
                    continue
                # Support vertices in normalized space preserve the wheel face on
                # thin parts. Use fewer directions on hubs and individual tread blocks.
                v = np.asarray(simplified.to_mesh64().vert_properties)[:, :3]
                n = {2: 36, 3: 21, 4: 13, 5: 8}[level]
                if t == 4 and max(extent) < radius * 1.45:
                    n = 7
                if len(v) > n:
                    a = np.arange(n)
                    yy = 1 - 2 * (a + 0.5) / n
                    r = np.sqrt(1 - yy * yy)
                    dirs = np.vstack(
                        [
                            np.stack([r * np.cos(a * 2.4), yy, r * np.sin(a * 2.4)], axis=1),
                            np.eye(3),
                            -np.eye(3),
                        ]
                    )
                    sel = np.argmax(
                        np.einsum("ij,kj->ik", (v - center) / np.maximum(extent, 0.00001), dirs), axis=0
                    )
                    simplified = Manifold.hull_points(v[np.unique(sel)])
            if simplified.is_empty():
                continue
            if fitted_wheel:
                simplified = m
            # Edge collapse can isolate a reversed sliver on the back of a panel.
            components = [island for island in simplified.decompose() if island.volume() > 1e-9]
            if not components:
                continue
            mesh = Manifold.compose(components).to_mesh64()
            v = np.asarray(mesh.vert_properties)[:, :3]
            f = np.asarray(mesh.tri_verts)
            records.append([b, t, v.round(6).flatten().tolist(), f.flatten().tolist()])
        (out / f"lod{level}.json.gz").write_bytes(
            gzip.compress(json.dumps(records, separators=(",", ":")).encode(), mtime=0)
        )
        counts.append(sum(len(r[3]) // 3 for r in records))
    budget = [counts[0], int(counts[0] * 0.72), *counts[1:]]
    (out / "budgets.json").write_text(json.dumps(budget) + "\n")
    print(name, budget)


if __name__ == "__main__":
    for name in sys.argv[1:]:
        make(name)
