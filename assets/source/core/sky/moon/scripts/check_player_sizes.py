#!/usr/bin/env python3
"""Supplementary 32/40/48/64px strip, generated from the finished sprite."""
from PIL import Image, ImageDraw
from build_moon import ROOT, font, PROFILE, NIGHT

moon = Image.open(ROOT/'moon.png')
plate = Image.new('RGB', (624, 192), NIGHT)
draw = ImageDraw.Draw(plate)
draw.text((24, 16), 'PLAYER SIZE / 100% PIXELS', font=font(16), fill=(190, 205, 223))
for center, size in [(90, 32), (230, 40), (370, 48), (510, 64)]:
    small = moon.resize((size, size), Image.Resampling.LANCZOS)
    plate.paste(small, (center-size//2, 100-size//2), small)
    draw.text((center, 150), f'{size} px', anchor='mt', font=font(14), fill=(168, 187, 210))
(ROOT/'iterations').mkdir(exist_ok=True)
plate.save(ROOT/'iterations/player-size.png', icc_profile=PROFILE)

# Retain a native-pixel comparison against the exact asset reviewed by the user.
baseline = ROOT/'iterations/round-4-baseline/moon.png'
if baseline.exists():
    from retouch_round5 import comparison
    comparison(Image.open(baseline), moon, 'ROUND FIVE / ROUND THREE AND LOCAL RETOUCH').save(
        ROOT/'iterations/round-5-comparison.png', icc_profile=PROFILE)
