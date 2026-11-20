# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy==2.5.4", "pillow==12.1.1"]
# ///
"""Paint the Meridian UV atlas and its surface maps. Run with Python, NumPy and Pillow."""

from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = Path(__file__).resolve().parent
N, PAD = 256, 6
rng = np.random.default_rng(71024)
v, u = np.mgrid[0:N, 0:N]
x, y = (u - PAD) / (N - 2 * PAD), (v - PAD) / (N - 2 * PAD)
SIDE = 512
atlas = {
    k: Image.new("RGB", (4 * SIDE, 4 * SIDE)) for k in ("finish", "normal", "orm", "dye")
}
font = ImageFont.load_default(size=12)
small = ImageFont.load_default(size=9)
# Base colour, roughness and metalness. Separate UV islands let small hardware keep its own finish.
swatches = [
    ((202, 205, 201), 131, 37),
    ((163, 174, 176), 130, 77),
    ((47, 55, 60), 195, 14),
    ((61, 74, 83), 111, 168),
    ((25, 72, 119), 44, 172),
    ((119, 229, 255), 72, 45),
    ((201, 129, 57), 128, 69),
    ((173, 185, 190), 84, 197),
    ((197, 202, 201), 121, 44),
    ((204, 207, 204), 128, 34),
    ((45, 58, 69), 143, 129),
    ((30, 40, 48), 186, 25),
    ((194, 200, 199), 119, 46),
    ((172, 179, 180), 137, 62),
    ((39, 59, 71), 121, 142),
    ((210, 212, 209), 124, 34),
]
# Four flat-lit material scans from the generated master. The subsections have distinct
# responses to light. Baked luminance is deliberately weaker on polished surfaces.
source = Image.open(ROOT / "engraving-source.png").convert("RGB")
half = source.width // 2
scans = []
for col, row in [(0, 0), (1, 0), (0, 1), (1, 1)]:
    left, top = col * half, row * half
    scans.append(source.crop((left+3, top+3, left+half-3, top+half-3))
                 .resize((SIDE, SIDE), Image.Resampling.LANCZOS))


def pixels(im):
    return np.asarray(im, dtype=np.float32)


def enlarged(im, nearest=False):
    return im.resize((SIDE, SIDE), Image.Resampling.NEAREST if nearest else Image.Resampling.BICUBIC)


def detailed(tile, img, h, orm):
    rgb, height, response = pixels(enlarged(img)), pixels(enlarged(h)), pixels(enlarged(orm))
    yy, xx = np.mgrid[:SIDE, :SIDE] / SIDE
    if tile == 4:
        # Cobalt interlayer. The actual moving highlight is supplied by the environment.
        rgb = np.stack([14 + 9*yy, 43 + 29*yy, 78 + 38*yy], axis=2)
        response[:] = [250, 31, 12]
    elif tile == 5:
        # Keep the glow blue even where its core catches direct sunlight.
        rgb *= [0.44, 0.78, 1.12]
        response[:] = [249, 72, 20]
    elif tile == 6:
        # A vulcanized palm has low, closely spaced staggered grip pads. The right
        # fifth keeps the original brass for the two small fasteners that use it.
        column = xx*35
        row = yy*32
        a = np.abs((column + 0.5*(np.floor(row) % 2)) % 1 - 0.5)
        b = np.abs(row % 1 - 0.5)
        pad = np.clip((0.49-np.maximum(b, 0.88*a+0.5*b))*15, 0, 1)
        groove = np.clip((0.13-np.abs((yy*5.5 + 0.12*np.cos(xx*7)) % 1-0.5))*10, 0, 1)
        grain = pixels(scans[2].convert("L"))
        rubber = 18 + pad*18 - groove*8 + np.clip(grain-np.median(grain),-22,28)*0.19
        grip = xx < 0.80
        rgb[grip] = (rubber[:, :, None] + [0, 4, 8])[grip]
        height[grip] = (119 + pad*18 - groove*13)[grip]
        response[:, :, 0][grip] = (178 + pad*61 - groove*18)[grip]
        response[:, :, 1][grip] = (210 - pad*32 + groove*9)[grip]
        response[:, :, 2][grip] = 3
    else:
        textile = tile in (2, 11)
        machined = tile in (3, 7, 10, 14)
        scan = scans[{2: 1, 11: 2}.get(tile, 3 if machined else 0)]
        if tile in (9, 12, 14):
            scan = scan.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
        if tile in (1, 13, 15):
            scan = scan.transpose(Image.Transpose.ROTATE_180)
        art = pixels(scan)
        lum = pixels(scan.convert("L"))
        blurred = pixels(scan.convert("L").filter(ImageFilter.GaussianBlur(3)))
        high = lum - blurred
        if textile:
            # Dark seams retain ambient occlusion in shade. The high yarns stay matte.
            rgb = art * (1.48 if tile == 2 else 1.27) + [7, 9, 11]
            height = 126 + (lum - np.median(lum))*0.78 + high*0.32
            response[:, :, 0] = np.clip(160 + lum*1.65 + high*0.9, 125, 250)
            response[:, :, 1] = np.clip((220 if tile == 2 else 171) + high*0.43, 140, 241)
            response[:, :, 2] = 4
        elif machined:
            # Fine polished cuts share the pattern with the normal map. No painted sun streak.
            rgb = 0.50*rgb + 0.44*art + (12 if tile in (3,7) else -10)
            height += 0.58*high
            response[:, :, 0] = np.clip(240 + 0.48*high, 195, 250)
            response[:, :, 1] = np.clip((50 if tile == 7 else 83) - high*0.44, 34, 130)
            response[:, :, 2] = 238 if tile == 7 else 206
        else:
            # The cobalt enamel, milled bead and satin field reflect independently.
            enamel = np.clip((art[:, :, 2] - art[:, :, 0] - 8) / 42, 0, 1)
            cut = np.clip((211 - blurred) / 68, 0, 1)
            # Hero engravings follow the sides of the breastplate and the brow. Keep
            # a quiet satin field through the middle for the form and its sun highlight.
            if tile in (0, 8, 15):
                field = np.clip((np.abs(xx - 0.51) - 0.09)*4.0 + (0.38-yy)*0.55, 0.12, 1)
            elif tile in (9, 12):
                field = np.clip((xx-0.24)*2.7, 0.13, 0.78)
            else:
                field = np.clip((0.48-yy)*2.8, 0.12, 0.64)
            strength = (0.84*field)[:, :, None]
            rgb = rgb*(1-strength) + art*strength
            height += field*(0.68*high - cut*5)
            cut *= field
            enamel *= field
            response[:, :, 0] = np.clip(247 - cut*34 + high*0.3, 167, 251)
            response[:, :, 1] = np.clip(93 - 35*cut - 18*enamel - high*0.19, 40, 107)
            response[:, :, 2] = 17 + 164*cut*(1-enamel)
            # Follow the padded UV border around the existing cut of each plate. A
            # bright metal fillet sits against a dark gasket, leaving its center pearl.
            rim = np.minimum(np.minimum(xx, 1-xx), np.minimum(yy, 1-yy)) - 0.035
            fillet = np.clip((0.012 - np.abs(rim - 0.022))*165, 0, 1)
            gasket = np.clip((0.008 - np.abs(rim - 0.040))*160, 0, 1)
            rgb *= 0.93 - 0.25*gasket[:, :, None]
            rgb = rgb*(1-fillet[:, :, None]) + np.array([209, 220, 228])*fillet[:, :, None]
            response[:, :, 1] = response[:, :, 1]*(1-fillet) + 36*fillet
            response[:, :, 2] = response[:, :, 2]*(1-fillet) + 247*fillet
            height += 13*fillet - 9*gasket
    dy, dx = np.gradient(height / 255)
    nn = np.stack([-dx*2.9, dy*2.9, np.ones_like(dx)], 2)
    if tile == 4:
        # The compound optical surface bows gently across both axes.
        nn[:, :, 0] += 0.10*(2*xx-1)
        nn[:, :, 1] += 0.32*(1-2*yy)
    nn /= np.sqrt((nn*nn).sum(axis=2, keepdims=True))
    return tuple(Image.fromarray(np.uint8(np.clip(a,0,255))) for a in (rgb,(nn*0.5+0.5)*255,response))


for i, (base, rough, metal) in enumerate(swatches):
    noise = rng.normal(0, 1, (N, N))
    grad = 3 * np.sin(x * 2.2) - 3 * y + noise * 0.85
    relief = noise * 0.09
    if i in (2, 11):
        warp = np.sin((u + v * 0.7) * 1.42) * np.sin((v - u * 0.65) * 1.32)
        rib = np.maximum(0, np.cos((u + v * 0.18) * 0.48)) ** 5
        grad = warp * 6 + rib * 4 + noise * 1.6
        relief = warp * 1.1 + rib * 0.9
    if i in (3, 7, 10, 14):
        grain = rng.normal(0, 1, (N, 1))
        grad += grain * 2.9 + np.sin(v * 0.42) * 1.1
        relief += grain * 0.31
    if i in (0, 1, 8, 9, 12, 13, 15):
        # Back-painted enamel thins into a darker bead at panel edges. Uneven satin polish is strongest on high spots.
        rim = np.minimum(np.minimum(abs(x), abs(1 - x)), np.minimum(abs(y), abs(1 - y)))
        edge = np.exp(-rim / 0.043)
        brushed = np.cos(x * 17 + y * 8) + 0.6 * np.sin(x * 21 - y * 11)
        grad += 2.0 * brushed - 19 * edge + 5 * np.exp(-(((rim - 0.033) / 0.008) ** 2))
        relief += 2 * np.exp(-(((rim - 0.03) / 0.008) ** 2))
    color = np.clip(np.array(base)[None, None, :] + grad[:, :, None], 0, 255)
    if i == 4:
        # Lamination bands and cobalt-to-midnight polarization, following the brow.
        band = np.exp(-(((y - 0.29 - 0.06 * np.sin(x * np.pi)) / 0.20) ** 2))
        lip = np.exp(-(((y - 0.20 - 0.05 * np.sin(x * np.pi)) / 0.018) ** 2))
        color = np.stack(
            [
                12 + band * 29 + lip * 15,
                36 + band * 68 + lip * 28,
                65 + band * 98 + lip * 33,
            ],
            axis=2,
        )
        color += noise[:, :, None] * 0.7
    if i == 5:
        color = (
            np.stack(
                [
                    75 + 45 * np.cos(y * 6),
                    184 + 26 * np.cos(y * 6),
                    221 + 20 * np.cos(y * 6),
                ],
                axis=2,
            )
            + noise[:, :, None]
        )
    img = Image.fromarray(np.uint8(np.clip(color, 0, 255)))
    h = Image.fromarray(np.uint8(np.clip(125 + relief * 6, 0, 255)))
    orm = Image.fromarray(
        np.uint8(
            np.stack(
                [
                    np.full((N, N), 249),
                    np.clip(rough + noise * 2, 0, 255),
                    np.full((N, N), metal),
                ],
                2,
            )
        )
    )
    dye = Image.new("RGB", (N, N))
    ink, dep, mat, mask = [ImageDraw.Draw(m) for m in (img, h, orm, dye)]

    def cut(points, width=2):
        dep.line(points, fill=103, width=width)
        ink.line(points, fill=tuple(int(k * 0.62) for k in base), width=width)
        mat.line(points, fill=(209, 140, metal), width=width)

    def screw(px, py):
        ink.ellipse(
            (px - 3, py - 3, px + 3, py + 3),
            fill=(97, 108, 116),
            outline=(156, 164, 169),
        )
        dep.ellipse((px - 3, py - 3, px + 3, py + 3), fill=101, outline=135)
        ink.line((px - 1, py + 1, px + 1, py - 1), fill=(54, 65, 72))

    if i in (0, 1, 8, 9, 12, 13, 15):
        # Recesses terminate before the lip. Leave the central field clean for highlights.
        cut([(21, 72), (21, 39), (36, 24), (93, 24)], 2)
        cut([(235, 177), (235, 211), (215, 231), (173, 231)], 2)
        for px, py in [(30, 43), (224, 212)]:
            screw(px, py)
        for j in range(26):
            px = int(rng.choice([rng.uniform(12, 26), rng.uniform(227, 244)]))
            py = int(rng.uniform(22, 230))
            span = int(rng.integers(2, 7))
            ink.line((px, py, px + 1, py + span), fill=(163, 175, 182), width=1)
            mat.line((px, py, px + 1, py + span), fill=(232, 112, 144))
        if i in (8, 9, 12, 13):
            ids = {8: "M / 01", 9: "M / 12", 12: "M / 04", 13: "M / 09"}
            ink.text((45, 177), ids[i], fill=(72, 91, 107), font=font)
            for j in range(9):
                ink.line(
                    (47 + j * 3, 197, 47 + j * 3, 201 + (j % 3)), fill=(97, 108, 116)
                )
            for j in range(2):
                ink.polygon(
                    [
                        (42 + j * 9, 155),
                        (48 + j * 9, 155),
                        (57 + j * 9, 145),
                        (51 + j * 9, 145),
                    ],
                    fill=(189, 125, 62),
                )
        if i in (0, 8, 9, 13):
            # An etched channel has a shallow rim on the lit side and a screw at each termination.
            path = (
                [(16, 124), (32, 109), (33, 87), (51, 67), (94, 60)]
                if i in (0, 8)
                else [(25, 219), (35, 178), (54, 152), (62, 111), (83, 88)]
            )
            cut(path, 2)
            ink.line(
                [(a + 2, b + 2) for a, b in path],
                fill=tuple(min(255, k + 7) for k in base),
                width=1,
            )
            for a, b in (path[1], path[-1]):
                screw(a, b)
        if i == 0:
            # Meridian datum etched into the right side of the continuous breastplate.
            ink.arc((162, 113, 184, 135), -80, 161, fill=(111, 130, 137), width=2)
            ink.line((172, 117, 168, 129, 177, 123), fill=(105, 122, 129), width=2)
            ink.text((158, 139), "M 01", fill=(112, 127, 132), font=small)
        if i in (8, 12):
            for j in range(4):
                ink.line(
                    (162, 208 + j * 4, 182 - j * 3, 208 + j * 4),
                    fill=(109, 126, 132),
                    width=1,
                )
        if i == 15:
            for j in (0, 1):
                ink.line(
                    (40, 80 + j * 6, 140, 80 + j * 6, 162, 58 + j * 6),
                    fill=(77, 95, 105),
                    width=2,
                )
    if i == 4:
        for k in range(21):
            px = 29 + k * 10
            ink.line((px, 196, px, 192 - (k % 5 == 0) * 3), fill=(79, 131, 161))
    if i in (10, 14):
        for j in range(6):
            py = 64 + j * 23
            cut([(42, py), (181, py), (207, py - 9)], 5)
            ink.line((43, py + 3, 179, py + 3), fill=(96, 112, 121))
    if i == 5:
        for px in range(12, N, 11):
            ink.line((px, 8, px, 247), fill=(94, 191, 216))
    if i == 1:
        mask.polygon(
            [(42, 96), (46, 91), (194, 91), (189, 96)], fill=(0, 255, 255)
        )  # wearable primary
    if i == 10:
        mask.rectangle((34, 40, 219, 46), fill=(255, 0, 255))  # wearable secondary
    if i == 4:
        mask.rectangle((14, 205, 242, 215), fill=(255, 255, 0))  # wearable trim
    img, normal, orm = detailed(i, img, h, orm)
    for name, pic in [("finish", img), ("normal", normal), ("orm", orm), ("dye", enlarged(dye, True))]:
        atlas[name].paste(pic, ((i % 4) * SIDE, (i // 4) * SIDE))
for name, img in atlas.items():
    img.save(ROOT / (name + ".png"), optimize=True)
