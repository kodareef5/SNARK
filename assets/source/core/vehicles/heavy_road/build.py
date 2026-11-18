"""Prepare native rigid meshes, distance shells and the two fleet liveries."""

import gzip
import json
import sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from donor import body_parts, hull

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "tanker"))
from geometry import box, shell

# Tiles also supply representative colours for the palette-only distance meshes.
PALETTE = [
    [229, 163, 45],
    [233, 222, 187],
    [45, 53, 52],
    [89, 107, 104],
    [40, 40, 39],
    [167, 175, 164],
    [66, 91, 81],
    [235, 222, 170],
    [184, 55, 43],
    [237, 145, 48],
    [104, 143, 143],
    [78, 64, 52],
    [68, 73, 65],
    [229, 163, 45],
    [229, 163, 45],
    [51, 56, 55],
]


def atlas(out, colors, bus):
    size = 256
    rng = np.random.default_rng(41)
    img = Image.new("RGB", (1024, 1024))
    for i, color in enumerate(colors):
        grain = rng.normal(0, 1.2, (size, size, 1))
        fade = np.linspace(3, -4, size)[:, None, None]
        patch = Image.fromarray(np.uint8(np.clip(np.array(color) + grain + fade, 0, 255)))
        d = ImageDraw.Draw(patch)

        def label(s, fs, pos, ink):
            font_path = next(
                (
                    p
                    for p in [
                        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
                        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
                    ]
                    if Path(p).exists()
                ),
                None,
            )
            d.text(
                pos,
                s,
                anchor="mm",
                fill=ink,
                font=ImageFont.truetype(font_path, fs) if font_path else ImageFont.load_default(size=fs),
            )

        if bus and i == 11:
            d.rectangle((0, 0, 255, 255), fill=(184, 55, 43))
            label("STOP", 76, (128, 126), (250, 237, 210))
        if i == 13:
            label(
                "SCHOOL BUS" if bus else "TIDELINE", 36, (128, 127), (36, 41, 39) if bus else (244, 226, 190)
            )
        if i == 14:
            label(
                "DISTRICT 07" if bus else "FREIGHT", 33, (128, 127), (52, 55, 43) if bus else (244, 226, 190)
            )
        if i in [13, 14]:
            # Condense the glyphs to the shape of a long destination/side board.
            patch = patch.crop((0, 97, 256, 156)).resize((size, size), Image.Resampling.LANCZOS)
        if i == 15:
            for x, r in [(61, 30), (128, 39), (196, 30)]:
                d.ellipse(
                    (x - r, 125 - r, x + r, 125 + r), fill=(32, 36, 35), outline=(172, 176, 153), width=5
                )
                for a in np.linspace(-2.6, 0.6, 9):
                    d.line(
                        (
                            x + (r - 6) * np.cos(a),
                            125 + (r - 6) * np.sin(a),
                            x + (r - 11) * np.cos(a),
                            125 + (r - 11) * np.sin(a),
                        ),
                        fill=(224, 215, 184),
                        width=2,
                    )
                d.line((x, 125, x - r * 0.55, 125 - r * 0.44), fill=(227, 139, 73), width=3)
        img.paste(patch, ((i % 4) * size, (i // 4) * size))
    img.save(out / "livery.png")
    packed = Image.new("RGB", img.size, (255, 186, 18))
    d = ImageDraw.Draw(packed)
    for i in [3, 5]:
        x, y = i % 4 * size, i // 4 * size
        d.rectangle((x, y, x + size - 1, y + size - 1), fill=(255, 122, 165))
    packed.save(out / "orm.png")


def build(name, level, donor):
    bus = name == "bus"
    mesh = []
    rig = {"chassis": [0, 0, 0]}

    def panel(p, size, tile, bone="chassis", rake=0):
        mesh.append(box(p, size, tile, "", bone, rake))

    def ring(stations, axis, n, tile, bone="chassis"):
        mesh.append(shell(stations, axis, n, tile, "", bone))

    def shape(v, tile, bone="chassis", samples=0):
        result = hull(np.asarray(v), samples)
        if result:
            mesh.append((*result, tile, "", bone))

    # Figures in the island lists refer to welded components of the archived donor.
    if bus:
        skip = {
            4,
            5,
            6,
            7,
            8,
            9,
            10,
            11,
            15,
            16,
            20,
            21,
            22,
            25,
            27,
            28,
            29,
            30,
            36,
            55,
            60,
            61,
            73,
            74,
            75,
            76,
            77,
            78,
            79,
            80,
            81,
        }
        skip.update([31, 32, 43, 44, 45, 46, 49, 50, 51, 52, 53, 54, 56, 57, 58, 59, 62, 63])
        paint = {26}
        arches = {3, 64}
        lamps = {14, 70}
        red = {18, 19, 67, 68}
        amber = {23, 24, 65, 66, 17, 69}
        light = {34, 35}
        metal = {0, 1, 2, 71, 72, 82, *range(37, 43)}
    else:
        skip = {14}
        paint = {26}
        arches = {3, 4, 5, 72, 73, 74}
        lamps = {18, 80}
        red = set()
        amber = {33, 48, 58, 59, 64}
        light = set()
        metal = {
            0,
            1,
            2,
            6,
            8,
            9,
            11,
            12,
            13,
            17,
            19,
            21,
            22,
            31,
            68,
            69,
            70,
            71,
            78,
            79,
            81,
            82,
            83,
            84,
            85,
            88,
            *range(38, 46),
        }
    for i, v in enumerate(donor):
        if i in skip or i in arches or bus and i in {14, 17, 18, 19, 23, 24, 65, 66, 67, 68, 69, 70}:
            continue
        if level == 5 and i not in ({12, 13, 26, 33} if bus else {6, 13, 19, 26, 30, 31, 68, 71}):
            continue
        span = np.ptp(v, axis=0)
        if level >= 3 and max(span) < {3: 0.1, 4: 0.4, 5: 0.55}[level] and i not in red | amber | lamps:
            continue
        if level >= 4 and i in metal and max(span) < 0.3:
            continue
        tile = (
            0
            if i in paint
            else 7
            if i in lamps
            else 8
            if i in red
            else 9
            if i in amber
            else 1
            if i in light
            else 5
            if i in metal
            else 2
        )
        if bus and i in {12, 13}:
            tile = 2
        shape(v, tile, samples={0: 0, 2: 48, 3: 28, 4: 15, 5: 8}[level])
    # Visible wheel openings, including the rolled return underneath the painted fender.
    axles = (
        [("front", 0.98, 4.275), ("rear", 0.89, -2.225)]
        if bus
        else [("front", 1.02, 2.546), ("middle", 0.9, -1.954), ("rear", 0.9, -3.274)]
    )
    radius = 0.5 if bus else 0.52
    n = {0: 48, 2: 24, 3: 16, 4: 12, 5: 8}[level]
    for axle, track, z in axles:
        for s, side in [(1, "left"), (-1, "right")]:
            x = track * s
            bone = f"wheel_{axle}_{side}"
            rig[bone] = [x, radius, z]
            width = 0.34 if axle == "front" else 0.50
            stations = [
                (-0.5, 0.79),
                (-0.46, 0.91),
                (-0.30, 0.99),
                (-0.16, 1),
                (0.16, 1),
                (0.30, 0.99),
                (0.46, 0.91),
                (0.5, 0.79),
            ]
            if level >= 3:
                stations = [(-0.5, 0.81), (-0.30, 1), (0.30, 1), (0.5, 0.81)]
            if level == 5:
                stations = [(-0.5, 1), (0.5, 1)]
            ring([(x + a * width, radius, z, r * radius, r * radius) for a, r in stations], "x", n, 4, bone)
            face = x + s * width * 0.5
            for a, b, r, t in [(0, 0.024, 0.62, 5), (0.025, 0.052, 0.35, 0)]:
                if level == 5 and a:
                    continue
                ring(
                    [(q, radius, z, r * radius, r * radius) for q in sorted([face + s * a, face + s * b])],
                    "x",
                    n if not a else max(8, n // 2),
                    t,
                    bone,
                )
            if level <= 2:
                for a in np.arange(8) * np.pi / 4:
                    cy, cz = radius + 0.224 * np.cos(a), z + 0.224 * np.sin(a)
                    ring(
                        [(q, cy, cz, 0.026, 0.026) for q in sorted([face + s * 0.022, face + s * 0.045])],
                        "x",
                        6,
                        2,
                        bone,
                    )
            # Each curved band is a single capped extruded annular segment.
            if level == 5 and axle != "front":
                continue
            angle = np.linspace(0.03, np.pi - 0.03, max(5, n // 2) + 1)
            profile = [
                (radius + r * np.sin(a), z + r * np.cos(a))
                for r, angles in [(0.72, angle), (0.59, angle[::-1])]
                for a in angles
            ]
            fender_segment(mesh, profile, *sorted([s * 0.61, s * 1.25]), 0 if axle == "front" or bus else 2)
    cab(mesh, rig, panel, ring, shape, bus, level)
    return rig, mesh


def fender_segment(mesh, profile, lo, hi, tile):
    # Wheel arches consist of an outer semicircle and the inner semicircle in reverse.
    v = np.array([(u, a, b) for u in [lo, hi] for a, b in profile])
    n = len(profile)
    f = []
    for i in range(n // 2 - 1):
        a, b, c, d = i, i + 1, n - i - 2, n - i - 1
        f.extend([[a, b, c], [a, c, d], [a + n, c + n, b + n], [a + n, d + n, c + n]])
    for a in range(n):
        b = (a + 1) % n
        f.extend([[a, b + n, b], [a, a + n, b + n]])
    f = np.array(f)
    p = v[f] - v.mean(0)
    if np.einsum("ij,ij->i", p[:, 0], np.cross(p[:, 1], p[:, 2])).sum() < 0:
        f = f[:, ::-1]
    mesh.append((v, f, tile, "", "chassis"))


def cab(mesh, rig, panel, ring, shape, bus, level):
    nose, tail = (3.61, -5.45) if bus else (2.04, -0.89)
    width = 1.20 if bus else 1.06
    sill = 1.78 if bus else 2.00
    header = 2.64 if bus else 2.90
    mid = (nose + tail) / 2
    span = nose - tail
    floor = 0.96 if bus else 1.15
    # The crown runs continuously from the destination board to the rear header.
    curve = [
        (-1, 0.0),
        (-1, 0.13),
        (-0.96, 0.25),
        (-0.85, 0.35),
        (-0.62, 0.40),
        (0, 0.425),
        (0.62, 0.40),
        (0.85, 0.35),
        (0.96, 0.25),
        (1, 0.13),
        (1, 0),
    ]
    shape([(x * width, header + y, z) for z in [nose, tail] for x, y in curve], 1 if bus else 0)
    panel((0, floor, mid), (width * 2, 0.16, span), 12)
    panel((0, (floor + sill) / 2, tail), (width * 2, sill - floor, 0.10), 0)
    panel((0, (sill + floor) / 2, nose), (width * 2, sill - floor, 0.12), 0)
    for z in [tail, nose]:
        panel((0, header + 0.096, z), (width * 1.95, 0.192, 0.09), 0)
        for x in [-width + 0.05, width - 0.05, 0]:
            panel((x, (sill + header) / 2, z), (0.082, header - sill, 0.09), 2 if x == 0 else 0)
        if bus:
            panel((0, header + 0.131, z + (0.052 if z == nose else -0.052)), (0.99, 0.219, 0.018), 13)
    if not bus:
        # Solid sleeper bulkhead aft of the two cab seats.
        panel((0, (header + floor) / 2, tail), (2.10, header - floor, 0.12), 0)
    for sign, side in [(1, "left"), (-1, "right")]:
        x = sign * width
        door = "door_" + side
        doorWidth = 0.82 if bus else 1.28
        hinge = nose - 0.05
        rig[door] = [x, (floor + sill) / 2, hinge]
        edge = hinge - doorWidth
        wall = (edge + tail) / 2
        if bus:
            # A raised lower skirt over the rear tyre exposes the whole wheel opening.
            for start, stop, base in [(tail, -2.84, 0.67), (-2.84, -1.61, 1.07), (-1.61, edge, 0.67)]:
                panel((x, (sill + base) / 2, (start + stop) / 2), (0.078, sill - base, stop - start), 0)
        else:
            panel((x, (sill + floor) / 2, wall), (0.083, sill - floor, edge - tail), 0)
            panel((x, (sill + header) / 2, wall), (0.089, header - sill, edge - tail), 0)
        dz = hinge - doorWidth / 2
        panel((x, (sill + floor) / 2, dz), (0.075, sill - floor, doorWidth), 0, door)
        for z in [edge, hinge]:
            panel((x, (sill + header) / 2, z), (0.076, header - sill, 0.062), 0, door)
        panel((x, header - 0.028, dz), (0.078, 0.056, doorWidth), 2, door)
        if bus:
            panes = 10 if level < 5 else 4
            for z in np.linspace(tail + 0.04, edge, panes + 1):
                panel((x, (header + sill) / 2, z), (0.065, header - sill, 0.082), 0)
            if level < 4:
                panel((x, (header + sill) / 2 + 0.10, wall), (0.055, 0.028, edge - tail), 5)
            if sign < 0:
                panel((x, (header + sill) / 2, dz), (0.086, header - sill, 0.031), 2, door)
                for i in range(3):
                    panel((x * (0.95 - i * 0.10), 0.54 + i * 0.17, dz), (0.17, 0.07, 0.77), 2)
        for y in [1.22, 1.65] if bus else [1.65]:
            for z, length, b in [(wall, edge - tail, "chassis"), (dz, doorWidth, door)]:
                panel((x * 1.032, y, z), (0.028, 0.055, length), 2 if bus else 1, b)
        if level <= 3:
            panel(
                (x * 1.043, (1.44 if bus else 1.79), wall if bus else dz),
                (0.018, 0.24, 1.56 if bus else 0.85),
                14,
                "chassis" if bus else door,
            )
            panel((x * 1.045, sill - 0.13, edge + 0.13), (0.04, 0.048, 0.18), 5, door)
    if bus:
        # Fit school-bus flashers to the face of the new crown; the donor's lenses were inset.
        for z, direction in [(nose, 1), (tail, -1)]:
            for x in [-0.94, -0.72, 0.72, 0.94]:
                ring(
                    [
                        (x, 2.80, q, 0.084, 0.084)
                        for q in sorted([z + direction * 0.052, z + direction * 0.087])
                    ],
                    "z",
                    12 if level < 4 else 6,
                    8 if abs(x) > 0.8 else 9,
                )
        for sign in [-1, 1]:
            panel((sign * 0.913, 1.042, 5.03), (0.58, 0.35, 0.42), 0)
            panel((sign * 0.929, 1.06, 5.247), (0.39, 0.19, 0.03), 2)
            panel((sign * 0.93, 1.067, 5.27), (0.32, 0.137, 0.035), 7)
        panel((0, 0.65, mid), (1.54, 0.40, span - 0.20), 2)
        if level < 4:
            for z in [-3.22, 0.57]:
                panel((0, 3.085, z), (0.80, 0.095, 0.80), 1)
        # Stop paddle stowed against the driver's side, on its own mounting bracket.
        ring([(x, 1.55, 2.40, 0.27, 0.27) for x in [1.245, 1.275]], "x", 8, 1)
        ring([(x, 1.55, 2.40, 0.246, 0.246) for x in [1.275, 1.29]], "x", 8, 11)
    else:
        # The steel grille and paired lamp housings sit over the bumper crossmember.
        for sign in [-1, 1]:
            panel((sign * 0.933, 1.102, 3.66), (0.51, 0.30, 0.34), 0)
            panel((sign * 0.933, 1.107, 3.842), (0.407, 0.202, 0.037), 3)
            for offset in [-0.091, 0.091]:
                panel((sign * 0.933 + offset, 1.107, 3.871), (0.153, 0.136, 0.029), 7)
            if level <= 3:
                panel((sign * 1.09, 2.28, -0.26), (0.024, 0.32, 0.94), 13)
                panel((sign * 1.09, 2.023, -0.26), (0.025, 0.07, 0.96), 1)
        panel((0, 2.912, 2.109), (2.12, 0.078, 0.272), 5)
    driver = (0.54, 1.46, 2.88) if bus else (0.49, 1.61, 1.24)

    def seat(x, y, z, w):
        panel((x, y - 0.062, z), (w, 0.134, 0.44), 6)
        panel((x, y + 0.21, z - 0.198), (w, 0.49, 0.105), 6, rake=-0.07)
        if level <= 2:
            panel((x, y - 0.24, z), (w * 0.46, 0.26, 0.22), 2)
            panel((x, y + 0.464, z - 0.237), (w * 0.94, 0.045, 0.095), 3)

    seat(*driver, 0.52)
    if bus:
        if level < 5:
            for z in [1.78, 0.58, -0.62, -1.82, -3.02, -4.22]:
                for x in [-0.67, 0.67]:
                    seat(x, 1.44, z, 0.83)
    else:
        seat(-0.49, 1.61, 1.24, 0.53)
    x, y, z = driver
    wheel = (x, y + 0.35, z + 0.425)
    rig["steering_wheel"] = list(wheel)
    # Tilted torus with a real centre opening and three spokes.
    count = {0: 32, 2: 20, 3: 14, 4: 10, 5: 8}[level]
    v = []
    f = []
    for i in range(count):
        a = i * 2 * np.pi / count
        for j in range(6):
            b = j * 2 * np.pi / 6
            r = 0.211 + 0.021 * np.cos(b)
            v.append(
                [
                    wheel[0] + r * np.cos(a),
                    wheel[1] + r * np.sin(a) * 0.78 + 0.021 * np.sin(b) * 0.62,
                    wheel[2] + r * np.sin(a) * 0.62 - 0.021 * np.sin(b) * 0.78,
                ]
            )
    for i in range(count):
        for j in range(6):
            a = i * 6 + j
            b = ((i + 1) % count) * 6 + j
            c = ((i + 1) % count) * 6 + (j + 1) % 6
            d = i * 6 + (j + 1) % 6
            f.extend([[a, c, b], [a, d, c]])
    mesh.append((np.array(v), np.array(f), 4, "", "steering_wheel"))
    panel(wheel, (0.411, 0.037, 0.038), 2, "steering_wheel")
    panel((x, y + 0.31, nose - 0.15), (1.03, 0.24, 0.26), 15)
    if level < 4:
        panel((-0.53, y + 0.29, nose - 0.14), (0.85, 0.19, 0.22), 12)
        for ix in [-0.54, 0.54]:
            panel((ix, sill + 0.035, nose + 0.06), (0.74, 0.022, 0.024), 2)


def write(name):
    out = HERE.parent / name
    bus = name == "bus"
    raw = HERE.parents[3] / "raw" / "grab3d" / ("school-bus.glb" if bus else "semi-truck.glb")
    donor = body_parts(raw, 0 if bus else 4.75)
    colors = [c[:] for c in PALETTE]
    if not bus:
        for i in [0, 13, 14]:
            colors[i] = [52, 107, 129]
    atlas(out, colors, bus)
    if bus:
        colors[11] = colors[8][:]
    (out / "palette.json").write_text(json.dumps(colors))
    for level in [0, 2, 3, 4, 5]:
        rig, parts = build(name, level, donor)
        records = [
            [bone, int(tile), v.round(5).flatten().tolist(), f.flatten().tolist()]
            for v, f, tile, _, bone in parts
        ]
        (out / f"lod{level}.json.gz").write_bytes(
            gzip.compress(json.dumps(records, separators=(",", ":")).encode(), mtime=0)
        )
        print(name, level, sum(len(f) for _, f, *_ in parts))
    (out / "rig.json").write_text(json.dumps(rig, indent=2) + "\n")


if __name__ == "__main__":
    for name in sys.argv[1:]:
        write(name)
