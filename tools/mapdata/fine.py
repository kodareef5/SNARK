"""The finer masks and the canopy: water, footprints and roads a metre a pixel on whole projection metres, the corrected
endpoint samples of the 2 m layers, and the crowns of the future canopy by the rule city.json names. The rule grows
crowns on the succession layer's vegetation and open ground at the shares it names, in groves shaped by a smooth field
of the place alone, so a wider cut of the city keeps every crown it had. Run after future.py.
python tools/mapdata/fine.py <map folder>"""
import json
import sys
from pathlib import Path
import numpy as np
from PIL import Image
from rasterio.warp import Resampling, reproject
from scipy import ndimage as nd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import folder_arg, save  # noqa: E402
from tunnels import tunnels  # noqa: E402

HIGHWAY = ('S1100', 'S1200')


# Rows of the fine grid the canopy's field is made for at a time.
BAND = 1024
# Metres between the field's knots: groves, and the crowns' edges within them.
GROVE_M, EDGE_M = 16.0, 4.0


def knots(seed, i, j):
    """A value in [-1, 1) for each knot (i, j) of the lattice, the same wherever a cut puts it."""
    h = (i.astype(np.uint64) * np.uint64(0x9E3779B97F4A7C15)) ^ (j.astype(np.uint64) * np.uint64(0xC2B2AE3D27D4EB4F)) ^ np.uint64(seed * 0x165667B19E3779F9 & 0xFFFFFFFFFFFFFFFF)
    h ^= h >> np.uint64(31)
    h *= np.uint64(0xBF58476D1CE4E5B9)
    h ^= h >> np.uint64(29)
    return (h >> np.uint64(40)).astype(np.float32) / np.float32(1 << 23) - np.float32(1)


def smooth(seed, e, n, cell):
    """Value noise over knots `cell` metres apart at the points of columns `e` and rows `n`, eased between knots."""
    fx, fy = e / cell, n / cell
    i0, j0 = np.floor(fx).astype(np.int64), np.floor(fy).astype(np.int64)
    u, v = fx - i0, fy - j0
    u, v = (u * u * (3 - 2 * u)).astype(np.float32), (v * v * (3 - 2 * v)).astype(np.float32)
    ii, jj = np.arange(i0.min(), i0.max() + 2), np.arange(j0.min(), j0.max() + 2)
    k = knots(seed, ii[None, :], jj[:, None])
    a, b = i0 - ii[0], j0 - jj[0]
    k00, k10, k01, k11 = k[b][:, a], k[b][:, a + 1], k[b + 1][:, a], k[b + 1][:, a + 1]
    top = k00 + (k10 - k00) * u[None, :]
    bottom = k01 + (k11 - k01) * u[None, :]
    return top + (bottom - top) * v[:, None]


def grove_field(seed, west, north, cols, rows):
    """The groves' field at the middles of `cols` by `rows` metre pixels from the corner (west, north), rows going south."""
    e = west + 0.5 + np.arange(cols, dtype=np.float64)
    n = north - 0.5 - np.arange(rows, dtype=np.float64)
    return smooth(seed, e, n, GROVE_M) + np.float32(.5) * smooth(seed + 1, e, n, EDGE_M)


def threshold(seed, q):
    """The field's `q` quantile, taken over one fixed square of the lattice, so it is the same for every cut."""
    return float(np.quantile(grove_field(seed, 0.0, 4096.0, 2048, 2048), q))


def edges(m, a, fine):
    """The 2 m layer's outer samples from the fine pixels they fall in."""
    (rows, cols), (frows, fcols) = m.shape, fine.shape
    ix = np.minimum((np.arange(cols, dtype=np.float64) * fcols / (cols - 1)).astype(int), fcols - 1)
    iy = np.minimum((np.arange(rows, dtype=np.float64) * frows / (rows - 1)).astype(int), frows - 1)
    a[0], a[-1], a[:, 0], a[:, -1] = fine[0, ix], fine[-1, ix], fine[iy, 0], fine[iy, -1]
    return a


def main():
    m = folder_arg()
    fine_grid = m.fine_shape()
    tx = m.transform(fine_grid)
    water = m.vectors('areawater')
    bld = m.vectors('buildings')
    roads = m.vectors('roads')
    tunnel_name = m.city['roads']['tunnel_name']
    changes = m.vectors('future_changes') if (m.base / 'future_changes.geojson').exists() else []
    gaps = [(g, 1) for g, p in changes if p['kind'] == 'missing_bridge_span']
    w_fine = m.burn([(g, 1) for g, p in water], fine_grid, tx)
    b_fine = m.burn([(g, 1) for g, p in bld], fine_grid, tx)
    save(w_fine, m.base / 'water_fine.png')
    save(b_fine, m.base / 'buildings_fine.png')
    # An airfield's paving (prepare.py's paved layer, value 6) lies under the roads.
    paved = [(g, 6) for g, p in m.vectors('paved')] if (m.base / 'paved.geojson').exists() else []
    hidden = tunnels(roads, water, tunnel_name)
    surface = paved + [(g.buffer(p['width_m'] / 2, cap_style=2, join_style=2), 2 if p['mtfcc'] in HIGHWAY else 1)
                       for _, g, p in sorted(((i, g, p) for i, (g, p) in enumerate(roads) if i not in hidden), key=lambda igp: igp[2]['width_m'])]
    below = [(g.buffer(p['width_m'] / 2, cap_style=2, join_style=2), 1) for i, (g, p) in enumerate(roads) if i in hidden]
    report = {}
    for size, t, suffix in [(fine_grid, tx, '_fine'), (m.shape, m.grid, '')]:
        wet = np.asarray(Image.open(m.base / f'water{suffix}.png')) > 0
        r = m.burn(surface, size, t)
        r[(r > 0) & wet] = 3
        r[(m.burn(below, size, t) > 0) & (r == 0)] = 4
        r[(m.burn(gaps, size, t) > 0) & (r == 3)] = 5
        path = m.base / f'roads{suffix}.png'
        if path.exists():
            report[f'roads{suffix}_changes'] = int((r != np.asarray(Image.open(path))).sum())
        save(r, path)
    r_fine = np.asarray(Image.open(m.base / 'roads_fine.png'))
    for name, fine in [('water', w_fine), ('buildings', b_fine), ('roads', r_fine)]:
        a = np.asarray(Image.open(m.base / f'{name}.png')).copy()
        before = a.copy()
        save(edges(m, a, fine), m.base / f'{name}.png')
        report[f'{name}_endpoint_corrections'] = int((a != before).sum())

    rule = m.city['canopy']
    biome = np.zeros(fine_grid, np.uint8)
    reproject(np.asarray(Image.open(m.base / 'biome.png')), biome, src_transform=m.grid, src_crs=m.crs,
              dst_transform=tx, dst_crs=m.crs, resampling=Resampling.nearest)
    free = (w_fine == 0) & (b_fine == 0) & (r_fine == 0) & (biome != 6)
    seed = rule.get('seed', 7)
    tops = {classes: threshold(seed, 1 - share) for classes, share in [((3, 4, 5), rule['share_of_vegetation']), ((2,), rule['share_of_open'])]}
    crown = np.zeros(fine_grid, bool)
    # The field a band of rows at a time: a whole 16 km cut's is a gigabyte.
    e0, n0 = m.b[0], m.b[3]
    for r0 in range(0, fine_grid[0], BAND):
        r1 = min(fine_grid[0], r0 + BAND)
        field = grove_field(seed, e0, n0 - r0, fine_grid[1], r1 - r0)
        for classes, top in tops.items():
            crown[r0:r1] |= free[r0:r1] & np.isin(biome[r0:r1], classes) & (field > top)
    shares = {str(classes): float(crown[free & np.isin(biome, classes)].mean()) if (free & np.isin(biome, classes)).any() else 0.0 for classes in tops}
    crown = nd.binary_opening(crown, iterations=1) & free
    fine = crown.astype(np.uint8)
    save(fine, m.base / 'painted_canopy_fine.png')
    base = np.zeros(m.shape, np.uint8)
    reproject(fine, base, src_transform=tx, dst_transform=m.grid, src_crs=m.crs, dst_crs=m.crs, resampling=Resampling.nearest)
    save(edges(m, base, fine), m.base / 'painted_canopy.png')
    (m.base / 'painted_canopy.json').write_text(json.dumps({
        'origin': 'Authored vegetation by rule, not a survey of present-day trees and not traced from a painting.',
        'rule': rule, 'shares_achieved': shares,
        'fine_grid': f'{fine_grid[1]} by {fine_grid[0]} pixel areas across map bounds; transform in map.json conventions',
        'base_grid': f'{m.shape[1]} by {m.shape[0]} vertex samples, 2 m spacing, endpoints included',
        'values': {'0': 'no added crown', '1': 'authored crown'}, 'fine_count': int(fine.sum()), 'base_count': int(base.sum())}, indent=2) + '\n')
    (m.root / 'reports').mkdir(exist_ok=True)
    (m.root / 'reports/canonical-layers.json').write_text(json.dumps(report, indent=2) + '\n')
    print(report, shares, int(base.sum()), 'canopy samples')


if __name__ == '__main__':
    main()
