# Reworks an ambientCG surface set (CC0) into a world finish's layers, with Pillow and numpy:
#   python3 -I rework.py <the set's 2K-PNG folder> <set id> <out folder> <metres> <height mm> <r,g,b mean or keep> <tint>
import sys, json
from PIL import Image
import numpy as np
folder, name, out, metres, height_mm, target, tint = sys.argv[1:8]
# A share of the way from the set's roughness to fully rough, where a set reads too glossy for this climate's dust.
drier = float(sys.argv[8]) if len(sys.argv) > 8 else 0.0
D = f'{folder}/{name}_2K-PNG_'
colour = np.asarray(Image.open(D + 'Color.png').convert('RGB'), dtype=float)
height = np.asarray(Image.open(D + 'Displacement.png'), dtype=float)
rough = np.asarray(Image.open(D + 'Roughness.png').convert('L'), dtype=float)
ao = np.asarray(Image.open(D + 'AmbientOcclusion.png').convert('L'), dtype=float)
lin = lambda c: np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
srgb = lambda c: np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(np.clip(c, 0, None), 1 / 2.4) - 0.055)
L = lin(colour / 255.0)
if target != 'keep':
    # Each channel's mean, in linear light, brought to the target; the set's own variation kept.
    L = L * (lin(np.array([float(v) for v in target.split(',')]) / 255.0) / L.reshape(-1, 3).mean(0))
base = np.clip(np.round(srgb(L) * 255), 0, 255).astype(np.uint8)
h = height if height.ndim == 2 else height[..., 0]
h = (h - h.min()) / (h.max() - h.min())
Image.fromarray(base).save(out + '/base.png')
Image.fromarray(np.round(h * 65535).astype(np.uint16)).save(out + '/height.png')
Image.fromarray(np.round(rough + (255 - rough) * drier).astype(np.uint8)).save(out + '/roughness.png')
Image.fromarray(ao.astype(np.uint8)).save(out + '/occlusion.png')
Image.fromarray(np.full(h.shape, round(float(tint) * 255), np.uint8)).save(out + '/tint.png')
mean = [int(round(v)) for v in base.reshape(-1, 3).mean(0)]
json.dump({"metres": float(metres), "height_mm": float(height_mm), "module": None, "mean_srgb": mean}, open(out + '/material.json', 'w'))
print(name, colour.shape, h.dtype, mean)
