#!/usr/bin/env python3
"""Build the requested native-resolution tint/LOD/repetition review sheet.

Uses straight-alpha, RGB multiplication, area-average mip reduction, and
bilinear magnification. All positions/scales/rotations are deterministic.
"""
from pathlib import Path
import json
import math
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
NAMES = ['dust_1', 'dust_2', 'dust_3', 'dust_4', 'grit']
MATERIALS = [('SAND', '#c9b48a'), ('DRY SOIL', '#8a7356'), ('PALE STONE', '#b5b2aa')]
INK = (233, 236, 233)
MUTED = (163, 172, 170)
PAGE = (19, 24, 27)


def font(size, bold=False):
    options = [
        '/System/Library/Fonts/Supplemental/Arial Bold.ttf' if bold else '/System/Library/Fonts/Supplemental/Arial.ttf',
        '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf' if bold else '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    ]
    for path in options:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default(size=size)


def rgb(value):
    return tuple(int(value[i:i+2], 16) for i in (1, 3, 5))


def bg(tint):
    return tuple(round(c * .43) for c in tint)


def asset(name, size=1024, tint=(255, 255, 255)):
    im = Image.open(ROOT / f'{name}.png').convert('RGBA')
    if size != 1024:
        # RGBa is premultiplied: avoids treating zero-alpha hidden RGB as visible.
        im = im.convert('RGBa').resize((size, size), Image.Resampling.BOX).convert('RGBA')
    a = np.asarray(im).copy()
    a[..., :3] = np.rint(a[..., :3].astype(float) * np.asarray(tint) / 255).astype(np.uint8)
    return Image.fromarray(a)


def paste(page, sprite, x, y):
    page.paste(sprite, (int(x), int(y)), sprite)


def label(draw, xy, text, size=24, bold=False, fill=INK):
    draw.text(xy, text, font=font(size, bold), fill=fill)


def ring(tint, size=1024):
    rng = np.random.default_rng(90210)
    out = Image.new('RGB', (1024, 800), bg(tint))
    order = np.tile(np.arange(1, 5), 3)
    rng.shuffle(order)
    layout = []
    for i, variant in enumerate(order):
        theta = i * 2 * math.pi / 12 + rng.uniform(-.055, .055)
        radius = 282 + rng.uniform(-15, 15)
        x = 512 + radius * math.cos(theta)
        y = 400 + radius * .62 * math.sin(theta)
        px = int(rng.uniform(215, 310))
        rotation = float(rng.uniform(0, 360))
        opacity = float(rng.uniform(.68, .94))
        sprite = asset(f'dust_{variant}', 128, tint).convert('RGBa')
        sprite = sprite.resize((px, px), Image.Resampling.BILINEAR)
        sprite = sprite.rotate(rotation, Image.Resampling.BICUBIC, expand=True).convert('RGBA')
        a = np.asarray(sprite).copy()
        a[..., 3] = np.rint(a[..., 3] * opacity).astype(np.uint8)
        sprite = Image.fromarray(a)
        layout.append({'variant': int(variant), 'x': x, 'y': y, 'size': px,
                       'rotation_degrees': rotation, 'opacity': opacity})
        paste(out, sprite, x - sprite.width / 2, y - sprite.height / 2)
    if size != 1024:
        out = out.resize((size, round(800 * size / 1024)), Image.Resampling.LANCZOS)
    return out, layout


def overview():
    page = Image.new('RGB', (1664, 1480), PAGE)
    d = ImageDraw.Draw(page)
    label(d, (32, 24), 'DUST / GRIT / WATER', 36, True)
    label(d, (32, 72), '128 px engine textures enlarged to 250 px  |  RGB tint x ground  |  straight alpha', 19, fill=MUTED)
    for j, (title, color) in enumerate(MATERIALS):
        y = 120 + j * 300
        tint = rgb(color)
        label(d, (32, y), f'{title}   {color}', 22, True)
        for i, name in enumerate(NAMES):
            x = 32 + i * 322
            panel = Image.new('RGB', (300, 250), bg(tint))
            sprite = asset(name, 128, tint).convert('RGBa').resize((250, 250), Image.Resampling.BILINEAR).convert('RGBA')
            paste(panel, sprite, 25, 0)
            page.paste(panel, (x, y + 32))
            label(d, (x + 8, y + 256), name + '.png', 16)
    y = 1030
    for j, (_, color) in enumerate(MATERIALS):
        panel, _ = ring(rgb(color), 510)
        page.paste(panel, (32 + j * 546, y))
    label(d, (32, 1440), 'Twelve puffs per ring; same seeded placement across all three grounds.', 20, fill=MUTED)
    page.save(ROOT / 'source_art' / 'preview_overview.png', optimize=True)


def main():
    page = Image.new('RGB', (3264, 9370), PAGE)
    d = ImageDraw.Draw(page)
    label(d, (48, 34), 'DUST / GRIT / WATER', 70, True)
    label(d, (48, 120), 'Native 1024 px masters + 128 px engine textures + 32 px distance check + 250 px phone check', 31, fill=MUTED)
    label(d, (48, 166), 'RGB multiplied by the exact swatch. Ground = swatch x 0.43. Alpha composited; no additive glow.', 28, fill=MUTED)
    for j, (title, color) in enumerate(MATERIALS):
        x = 48 + j * 1072
        d.rectangle((x, 234, x + 34, 268), fill=rgb(color))
        label(d, (x + 48, 230), f'{title}  {color}', 34, True)
    for i, name in enumerate(NAMES):
        top = 294 + i * 1430
        for j, (_, color) in enumerate(MATERIALS):
            x = 48 + j * 1072
            tint = rgb(color)
            label(d, (x, top), f'{name}.png  /  1024 px, 1:1', 30, True)
            panel = Image.new('RGB', (1024, 1330), bg(tint))
            paste(panel, asset(name, 1024, tint), 0, 0)
            paste(panel, asset(name, 128, tint), 34, 1100)
            paste(panel, asset(name, 32, tint), 221, 1148)
            phone = asset(name, 128, tint).convert('RGBa').resize((250, 250), Image.Resampling.BILINEAR).convert('RGBA')
            paste(panel, phone, 336, 1045)
            # Show alpha separately at 250px without tint to make clear margins reviewable.
            mask = Image.open(ROOT / f'{name}.png').getchannel('A').resize((250, 250), Image.Resampling.BOX)
            panel.paste(Image.merge('RGB', (mask, mask, mask)), (724, 1045))
            pd = ImageDraw.Draw(panel)
            label(pd, (32, 1298), '128 px', 21)
            label(pd, (202, 1298), '32 px', 21)
            label(pd, (336, 1298), '128 -> 250 px (bilinear)', 21)
            label(pd, (724, 1298), 'Alpha inspection', 21)
            page.paste(panel, (x, top + 48))
    top = 7470
    label(d, (48, top), 'REPETITION / TWELVE PUFFS', 46, True)
    label(d, (48, top + 60), 'Four variants, three uses each. Seeded random rotation, scale, position and opacity. 128 px input textures.', 28, fill=MUTED)
    for j, (title, color) in enumerate(MATERIALS):
        x = 48 + j * 1072
        panel, layout = ring(rgb(color))
        page.paste(panel, (x, top + 110))
    (ROOT / 'ring_layout.json').write_text(json.dumps({'seed': 90210, 'puffs': layout}, indent=2) + '\n')
    top = 8460
    label(d, (48, top), 'WATER / ROUND DROP + SINGLE RIPPLE CREST', 46, True)
    label(d, (48, top + 58), 'Sky multiplier #dce5eb; dark still-water background. No interior fill in the ripple.', 28, fill=MUTED)
    for j, name in enumerate(['drop', 'ripple']):
        x = 48 + j * 1608
        panel = Image.new('RGB', (1560, 590), (30, 46, 53))
        paste(panel, asset(name, 512, rgb('#dce5eb')), 16, 22)
        paste(panel, asset(name, 128, rgb('#dce5eb')), 584, 204)
        paste(panel, asset(name, 32, rgb('#dce5eb')), 786, 252)
        phone = asset(name, 128, rgb('#dce5eb')).convert('RGBa').resize((250, 250), Image.Resampling.BILINEAR).convert('RGBA')
        paste(panel, phone, 940, 144)
        pd = ImageDraw.Draw(panel)
        label(pd, (24, 550), name + '.png / 512 px preview', 24)
        label(pd, (580, 550), '128 px', 24)
        label(pd, (764, 550), '32 px', 24)
        label(pd, (940, 550), '128 -> 250 px', 24)
        page.paste(panel, (x, top + 108))
    label(d, (48, 9210), 'Inspect at 100% zoom for true pixel sizes. The separate overview is in source_art/preview_overview.png.', 28, fill=MUTED)
    label(d, (48, 9260), 'Static placement approximation; timing and blending must still be judged in the game. Rebuild: python3 build_preview.py', 26, fill=MUTED)
    page.save(ROOT / 'preview.png', optimize=True)
    overview()
    # Saved inspection crops let reviewers examine real pixel sizes quickly.
    page.crop((0, 294, 1120, 1690)).save(ROOT / 'source_art' / 'qa_native_dust.png', optimize=True)
    page.crop((0, 8460, 3264, 9160)).resize((1632, 350), Image.Resampling.LANCZOS).save(ROOT / 'source_art' / 'qa_water.png', optimize=True)
    # Small sizes remain unscaled here, including a nearly invisible 32px ripple.
    quick = Image.new('RGB', (1060, 490), PAGE)
    qd = ImageDraw.Draw(quick)
    label(qd, (22, 16), 'Actual 128 px + 32 px samples', 24, True)
    for i, name in enumerate(NAMES + ['drop', 'ripple']):
        x = 16 + i * 148
        tint = rgb('#c9b48a') if i < 5 else rgb('#dce5eb')
        ground = bg(tint) if i < 5 else (30, 46, 53)
        qd.rectangle((x, 60, x + 139, 458), fill=ground)
        paste(quick, asset(name, 128, tint), x + 6, 82)
        paste(quick, asset(name, 32, tint), x + 54, 252)
        label(qd, (x + 6, 330), name, 18)
        label(qd, (x + 6, 360), '128 / 32 px', 16)
    quick.save(ROOT / 'source_art' / 'qa_small_sizes.png', optimize=True)
    print('Saved preview.png (3264 x 9370) and source_art/preview_overview.png')


if __name__ == '__main__':
    main()
