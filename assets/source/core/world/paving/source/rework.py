# Reworks Poly Haven's large_square_pattern_01 (CC0) into a world finish's layers, with Pillow and numpy:
#   python3 -I rework.py <the set's 2k folder> <out folder>
import sys, json
from PIL import Image, ImageFilter
import numpy as np
D, out = sys.argv[1] + '/large_square_pattern_01_', sys.argv[2]
diff = np.asarray(Image.open(D + 'diff_2k.jpg').convert('RGB'), dtype=float)
disp = np.asarray(Image.open(D + 'disp_2k.png'))[..., 0].astype(float)
rough = np.asarray(Image.open(D + 'rough_2k.jpg').convert('L'), dtype=float)
ao = np.asarray(Image.open(D + 'ao_2k.jpg').convert('L'), dtype=float)
# Colour: each channel's mean brought to a neutral concrete grey in linear light, keeping its own variation.
lin = lambda c: np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
srgb = lambda c: np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(np.clip(c, 0, None), 1 / 2.4) - 0.055)
target = lin(np.array([128, 125, 119]) / 255.0)
L = lin(diff / 255.0)
L = L * (target / L.reshape(-1, 3).mean(0))
base = np.clip(np.round(srgb(L) * 255), 0, 255).astype(np.uint8)
# Height: the 8-bit displacement softened by a pixel so its steps do not show as terraces, kept at 16 bits.
h = np.asarray(Image.fromarray(disp.astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.9)), dtype=float)
h = (h - h.min()) / (h.max() - h.min())
# Tint: the slabs take a lot's colour, the joints and what grows in them keep their own.
t = np.clip((h - np.percentile(h, 10)) / (np.percentile(h, 30) - np.percentile(h, 10)), 0, 1)
Image.fromarray(base).save(out + '/base.png')
Image.fromarray(np.round(h * 65535).astype(np.uint16)).save(out + '/height.png')
Image.fromarray(rough.astype(np.uint8)).save(out + '/roughness.png')
Image.fromarray(ao.astype(np.uint8)).save(out + '/occlusion.png')
Image.fromarray(np.round(t * 255).astype(np.uint8)).save(out + '/tint.png')
mean = [int(round(v)) for v in base.reshape(-1, 3).mean(0)]
json.dump({"metres": 3, "height_mm": 25, "module": [1 / 3, 1 / 3], "mean_srgb": mean}, open(out + '/material.json', 'w'))
print(mean, round(float(t.mean()), 3))
