# The road's masks (assets/source/core/world/road/), from open-library sets fetched for this game on 2026-11-18, each
# CC0 as its library's licence page states for all its assets. The files as they came stay outside the repository.
# - Poly Haven's aerial_asphalt_01, its 4k diffuse and roughness: a used asphalt surface from above, 30 m a side.
# - Poly Haven's aerial_beach_01, its 4k diffuse and roughness: pale sand with fields of wave ripples, 30 m a side.
# - ambientCG's Road013C, its 2K JPG colour and displacement: rectangular saw-cut patches along a road's lanes, sealed.
# - ambientCG's Road012C, its 2K JPG displacement: a road's network of cracks.
# The macros (asphalt, beach and their roughness) are drawn over 32 m, the repairs (patches, seams, seals, cracks) over
# 8 m; the client build packs each four into one packed map, red to alpha, in that order (tools/surfaces/build.ts).
#
# Reworks them into the masks, with Pillow and numpy:
#   python3 -I rework.py <aerial_asphalt_01 4k folder> <aerial_beach_01 4k folder> <Road013C 2K-JPG folder> <Road012C 2K-JPG folder> <out>
# Each mask is 1024 pixels a side, grey, 8 bits. The macros say a value or a roughness as a share of the set's own mean,
# 128 for the mean; the repairs say where a patch, its seams and a road's cracks are, 0 for none.
import sys, json
from PIL import Image, ImageFilter
import numpy as np
asphalt, beach, patched, cracked, out = sys.argv[1:6]
Image.MAX_IMAGE_PIXELS = None
N = 1024
def grey(path):
    return np.asarray(Image.open(path).convert('L').resize((N, N), Image.LANCZOS), dtype=float) / 255.0
def blur(a, r):
    # Wrapped, so the mask still tiles.
    big = np.tile(a, (3, 3))
    im = Image.fromarray(np.clip(big * 255, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(r))
    return (np.asarray(im, dtype=float) / 255.0)[N:2 * N, N:2 * N]
def grow(a, size):
    big = np.tile(a, (3, 3))
    im = Image.fromarray(np.clip(big * 255, 0, 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(size))
    return (np.asarray(im, dtype=float) / 255.0)[N:2 * N, N:2 * N]
def shrink(a, size):
    return 1 - grow(1 - a, size)
lin = lambda c: np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
def save(a, name):
    Image.fromarray(np.clip(np.round(a * 255), 0, 255).astype(np.uint8)).save(f'{out}/{name}.png')
def share(a, spread):
    # A share of the mean, 128 for it and `spread` either way at 0 and 255.
    return 0.5 + (a / a.mean() - 1) / (2 * spread)
stats = {}
# The macros: the aerial sets' light and roughness, their grain under about 20 cm taken out, which the finishes have.
for name, folder, stem in [('asphalt', asphalt, 'aerial_asphalt_01'), ('beach', beach, 'aerial_beach_01')]:
    value = blur(lin(grey(f'{folder}/{stem}_diff_4k.jpg')), 3.0)
    rough = blur(grey(f'{folder}/{stem}_rough_4k.jpg'), 3.0)
    save(share(value, 0.5), name)
    save(share(rough, 0.125), f'{name}-rough')
    stats[name] = [round(float(np.percentile(value / value.mean(), p)), 3) for p in (1, 50, 99)]
    stats[f'{name}-rough'] = [round(float(np.percentile(rough / rough.mean(), p)), 3) for p in (1, 50, 99)]
# The repairs: Road013C's saw-cut patches, darker than the road round them, and the raised sealant over their seams;
# and the cracks of Road012C and Road013C, by how deep each is under the road round it.
d13 = grey(f'{patched}/Road013C_2K-JPG_Displacement.jpg')
seams = blur(np.clip((d13 - blur(d13, 6) - 0.03) / 0.05, 0, 1), 0.8)
# A patch is what its seams close in: the road outside them is filled from its lightest open ground, and what the
# fill does not reach, off the seams, is patch. A seam left open lets the fill in, and that patch keeps only its seam.
# The fill keeps to ground lighter than most patches, so a gap in a seam lets in little.
c13 = blur(grey(f'{patched}/Road013C_2K-JPG_Color.jpg'), 6)
wall = (grow((seams > 0.25).astype(float), 7) > 0.5) | (c13 < np.percentile(c13, 30))
road = (c13 > np.percentile(c13, 90)) & ~wall
while True:
    spread = road | np.roll(road, 1, 0) | np.roll(road, -1, 0) | np.roll(road, 1, 1) | np.roll(road, -1, 1)
    spread &= ~wall
    if (spread == road).all():
        break
    road = spread
inside = blur(grow(shrink(shrink((~road).astype(float), 3), 19), 19), 1.5)
d12 = grey(f'{cracked}/Road012C_2K-JPG_Displacement.jpg')
seals = blur(np.clip((blur(d12, 4) - d12 - 0.06) / 0.2, 0, 1), 1.2)
cracks = np.clip((blur(d13, 4) - d13 - 0.04) / 0.12, 0, 1)
save(inside, 'patches')
save(seams, 'seams')
save(seals, 'seals')
save(cracks, 'cracks')
stats['patched'] = round(float(inside.mean()), 3)
stats['seams'] = round(float(seams.mean()), 3)
stats['seals'] = round(float(seals.mean()), 3)
json.dump(stats, sys.stdout)
print()
