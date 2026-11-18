# The sidewalk finish (assets/source/core/world/sidewalk/): poured concrete, broom-finished, in 1.5 m panels whose
# tooled joints run both ways, made from Poly Haven's concrete_pavement (CC0 as Poly Haven's licence page states for
# all its assets; its 1k diffuse, displacement and roughness, fetched for this game on 2026-11-18, which stay outside the
# repository). Of that set only its concrete's grain is kept: its slabs' joints are filled from round them and its
# slabs' tone taken out, and the grain is laid into four panels of a 3 m tile, each at its own place in the set's tile.
# The broom's streaks, the tooled joints and margins and each panel's tone are made here. With Pillow and numpy:
#   python3 -I rework.py <concrete_pavement 1k folder> <out folder>
import sys, json
from PIL import Image
import numpy as np
src, out = sys.argv[1:3]
N, P = 2048, 1024
rng = np.random.default_rng(1515)
def grey(name):
    return np.asarray(Image.open(f'{src}/concrete_pavement_{name}_1k.jpg').convert('L'), dtype=float) / 255.0
def blur(a, r):
    # A Gaussian of r pixels, the picture wrapping as a tile does.
    fy, fx = np.fft.fftfreq(a.shape[0])[:, None], np.fft.fftfreq(a.shape[1])[None, :]
    return np.real(np.fft.ifft2(np.fft.fft2(a) * np.exp(-2 * (np.pi * r) ** 2 * (fx ** 2 + fy ** 2))))
lin = lambda c: np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
srgb = lambda c: np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(np.clip(c, 0, None), 1 / 2.4) - 0.055)
colour = lin(np.asarray(Image.open(f'{src}/concrete_pavement_diff_1k.jpg').convert('RGB'), dtype=float) / 255.0)
height, rough = grey('disp'), grey('rough')
# The set's joints: where its height drops under the ground round it. Filled from what is round them.
joint = np.clip((blur(height, 4) - height - 0.03) / 0.04, 0, 1)
joint = np.clip(blur(joint, 1.5) * 3, 0, 1)
joint = np.clip(blur(joint, 2.5) * 4, 0, 1)
keep = 1 - joint
def fill(a):
    # Each joint takes the grain beside it, from a copy moved off the joint, and what still falls on one its mean.
    out = a * keep
    left = joint.copy()
    for dy, dx in [(13, 9), (-11, 17), (19, -14)]:
        k = np.roll(keep, (dy, dx), axis=(0, 1)) * left
        out += np.roll(a, (dy, dx), axis=(0, 1)) * k
        left = left - k
    return out + a.mean() * left
lum = colour.mean(2)
grain = fill(lum) / blur(fill(lum), 16)
bump = fill(height) - blur(fill(height), 16)
rough = fill(rough)
# Four panels of P pixels (1.5 m), each the set's tile moved round on itself.
def panels(a):
    t = np.zeros((N, N) + a.shape[2:])
    for k, (dy, dx) in enumerate([(0, 0), (377, 613), (701, 229), (163, 887)]):
        y, x = divmod(k, 2)
        t[y * P:(y + 1) * P, x * P:(x + 1) * P] = np.roll(a, (dy, dx), axis=(0, 1))
    return t
grain, bump, rough = panels(grain), panels(bump), panels(rough)
# Distance in metres to the nearest joint, the tile's own edges and middles.
m = 1.5 / P
yy, xx = np.mgrid[0:N, 0:N]
dj = np.minimum(np.minimum(xx % P, P - xx % P), np.minimum(yy % P, P - yy % P)) * m
groove = np.exp(-(dj / 0.004) ** 2)
margin = np.clip((dj - 0.006) / 0.035, 0, 1)
# The broom: fine streaks across x, a few millimetres apart, each running some centimetres.
streak = np.repeat(rng.normal(size=(N, N // 32)), 32, axis=1)
streak = blur(streak, 0.8)
streak = np.real(np.fft.ifft2(np.fft.fft2(streak) * np.exp(-2 * np.pi ** 2 * (np.fft.fftfreq(N)[None, :] * 24) ** 2)))
streak = (streak - streak.mean()) / streak.std()
broom = streak * (0.35 + 0.65 * margin)
# Each panel's tone, a few in a hundred either way.
tone = np.ones((N, N))
for k, t in enumerate([1.0, 1.035, 0.97, 1.015]):
    y, x = divmod(k, 2)
    tone[y * P:(y + 1) * P, x * P:(x + 1) * P] = t
target = lin(np.array([158, 154, 147]) / 255.0)
value = grain * tone * (1 + 0.012 * broom) * (1 - 0.45 * groove) * (1 - 0.06 * (1 - margin))
base = target[None, None, :] * value[..., None]
h = 0.5 + bump * 1.5 + 0.03 * broom * (1 - groove) - 0.55 * groove
h = (h - h.min()) / (h.max() - h.min())
r = np.clip(rough * 0.97 + 0.02 * broom - 0.06 * (1 - margin) + 0.1 * groove, 0, 1)
occ = np.clip(1 - 0.5 * groove, 0, 1)
s = np.clip(np.round(srgb(base) * 255), 0, 255).astype(np.uint8)
Image.fromarray(s).save(f'{out}/base.png')
Image.fromarray(np.round(h * 65535).astype(np.uint16)).save(f'{out}/height.png')
Image.fromarray(np.round(r * 255).astype(np.uint8)).save(f'{out}/roughness.png')
Image.fromarray(np.round(occ * 255).astype(np.uint8)).save(f'{out}/occlusion.png')
Image.fromarray(np.full((N, N), 255, np.uint8)).save(f'{out}/tint.png')
mean = [int(v) for v in np.round(s.reshape(-1, 3).mean(0))]
json.dump({"metres": 3.0, "height_mm": 8.0, "module": [0.5, 0.5], "mean_srgb": mean}, open(f'{out}/material.json', 'w'))
print(mean, round(float(r.mean()), 3))
