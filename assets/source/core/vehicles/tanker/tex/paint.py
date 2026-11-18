"""One 1024 atlas for the water district livery, cab instruments and hardware."""

from pathlib import Path
import math
import numpy as np
from PIL import Image, ImageDraw, ImageFont

out = Path(__file__).resolve().parent
fontdir = Path("/System/Library/Fonts/Supplemental")


def font(size):
    return ImageFont.truetype(
        str(fontdir / "Arial Narrow Bold.ttf")
        if (fontdir / "Arial Narrow Bold.ttf").exists()
        else "DejaVuSans-Bold.ttf",
        size,
    )


# Name order is shared with geometry.py. Four columns, four rows under the tank.
colours = [
    (31, 99, 94),
    (237, 226, 189),
    (215, 154, 58),
    (60, 77, 78),
    (38, 40, 39),
    (149, 156, 146),
    (81, 73, 54),
    (223, 218, 173),
    (167, 62, 43),
    (233, 167, 62),
    (103, 135, 133),
    (62, 62, 54),
    (49, 55, 53),
    (96, 78, 59),
    (59, 109, 106),
    (31, 36, 37),
]
rng = np.random.default_rng(3109)


def field(n):
    v = Image.fromarray(rng.integers(0, 256, (n, n), dtype="uint8"))
    return np.array(v.resize((1024, 1024), Image.Resampling.BICUBIC), float) / 255


large, medium, grain = field(12), field(75), field(1024)
streak = (
    np.array(
        Image.fromarray(rng.integers(0, 256, (72, 768), dtype="uint8")).resize(
            (1024, 1024), Image.Resampling.BICUBIC
        ),
        float,
    )
    / 255
)
base = Image.new("RGB", (1024, 1024), (229, 222, 191))
d = ImageDraw.Draw(base)
for y0, y1, c in [(332, 339, colours[2]), (341, 391, colours[0]), (392, 403, colours[2])]:
    d.rectangle((0, y0, 1023, y1), fill=c)
# Each panel between the straps has generous clear space round the markings.
d.text((715, 220), "TIDELINE", font=font(51), anchor="mm", fill=(30, 83, 79))
d.text((715, 266), "W A T E R   D I S T R I C T", font=font(16), anchor="mm", fill=(42, 79, 75))
for dx in [-32, 0, 32]:
    d.line([(682 + dx, 208), (697 + dx, 203), (712 + dx, 208)], fill=(172, 122, 55), width=4)
d.text((186, 365), "POTABLE   •   08", font=font(18), anchor="mm", fill=colours[1])
for i, c in enumerate(colours):
    x = (i % 4) * 256
    y = 512 + (i // 4) * 128
    d.rectangle((x, y, x + 255, y + 127), fill=c)
# Enamel fleet plate. The square is also the stencil's border on both doors.
d.rounded_rectangle((258, 898, 509, 1020), radius=9, fill=(207, 189, 145), outline=colours[3], width=6)
d.text((384, 929), "WATER DISTRICT", font=font(21), anchor="mm", fill=colours[3])
d.text((384, 980), "UNIT   08", font=font(42), anchor="mm", fill=(31, 78, 75))
# Instrument binnacle: three recessed analog dials, telltales, warm needles.
for x, r in [(811, 29), (883, 36), (960, 27)]:
    y = 952
    for rr, c in [(r + 3, colours[5]), (r + 1, (31, 37, 36)), (r - 4, (56, 67, 62))]:
        d.ellipse((x - rr, y - rr, x + rr, y + rr), fill=c)
    for a in range(138, 405, 19):
        co, si = math.cos(math.radians(a)), math.sin(math.radians(a))
        d.line(
            [(x + (r - 3) * co, y + (r - 3) * si), (x + (r - 8) * co, y + (r - 8) * si)],
            fill=colours[1],
            width=2,
        )
    d.line((x, y, x - r * 0.52, y - r * 0.38), fill=(255, 145, 67), width=3)
for i in range(6):
    d.rectangle((840 + i * 13, 1001, 847 + i * 13, 1004), fill=colours[[0, 2, 8][i % 3]])
pixels = np.asarray(base, float)
for weather in ("service", "salvage"):
    worn = weather == "salvage"
    shade = (grain - 0.5) * 6 + (medium - 0.5) * (15 if worn else 4) + (large - 0.5) * (30 if worn else 8)
    rgb = pixels + shade[:, :, None]
    if worn:
        rust = np.clip((large * 0.45 + medium * 0.26 + streak * 0.25 + grain * 0.04 - 0.51) * 4.6, 0, 0.79)
        oxide = np.stack([105 + medium * 38, 64 + grain * 16, 43 + large * 15], axis=2)
        rgb = rgb * (1 - rust[:, :, None]) + oxide * rust[:, :, None]
    Image.fromarray(rgb.clip(0, 255).astype("uint8")).save(out / (weather + ".png"), optimize=True)
packed = np.full((1024, 1024, 3), [255, 161, 28], dtype="uint8")
for i in range(16):
    y = 512 + (i // 4) * 128
    x = (i % 4) * 256
    packed[y : y + 128, x : x + 256] = [
        245,
        [125, 155, 165, 180, 229, 103, 239, 84, 112, 132, 110, 199, 217, 222, 180, 154][i],
        172 if i in [3, 5] else 10,
    ]
Image.fromarray(packed).save(out / "orm.png", optimize=True)
