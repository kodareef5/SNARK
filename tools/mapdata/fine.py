"""The finer masks and the canopy: water, footprints and roads at 8,192 pixel areas across the map, as Miami's canonical.py
and reference.py left them, the corrected endpoint samples of the 2 m layers, and the crowns of the future canopy by
the rule city.json names. Miami's canopy was traced from its paintings; with no paintings, the rule grows crowns on
the succession layer's vegetation and open ground at the shares Miami's paint covers them, in groves shaped by a
seeded smooth field. Run after future.py. python tools/mapdata/fine.py <map folder>"""
import json
import sys
from pathlib import Path
import numpy as np
from PIL import Image
from rasterio.warp import Resampling, reproject
from scipy import ndimage as nd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import folder_arg, save  # noqa: E402

FINE = 8192
HIGHWAY = ('S1100', 'S1200')


def edges(m, a, fine):
    ix = np.minimum((np.arange(m.n, dtype=np.float64) * FINE / (m.n - 1)).astype(int), FINE - 1)
    a[0], a[-1], a[:, 0], a[:, -1] = fine[0, ix], fine[-1, ix], fine[ix, 0], fine[ix, -1]
    return a


def main():
    m = folder_arg()
    tx = m.transform(FINE)
    water = m.vectors('areawater')
    bld = m.vectors('buildings')
    roads = m.vectors('roads')
    tunnel_name = m.city['roads']['tunnel_name']
    changes = m.vectors('future_changes') if (m.base / 'future_changes.geojson').exists() else []
    gaps = [(g, 1) for g, p in changes if p['kind'] == 'missing_bridge_span']
    w_fine = m.burn([(g, 1) for g, p in water], FINE, tx)
    b_fine = m.burn([(g, 1) for g, p in bld], FINE, tx)
    save(w_fine, m.base / 'water_fine.png')
    save(b_fine, m.base / 'buildings_fine.png')
    # An airfield's paving (prepare.py's paved layer, value 6) lies under the roads.
    paved = [(g, 6) for g, p in m.vectors('paved')] if (m.base / 'paved.geojson').exists() else []
    surface = paved + [(g.buffer(p['width_m'] / 2, cap_style=2, join_style=2), 2 if p['mtfcc'] in HIGHWAY else 1)
                       for g, p in sorted(roads, key=lambda gp: gp[1]['width_m']) if tunnel_name not in (p['name'] or '').lower()]
    tunnels = [(g.buffer(p['width_m'] / 2, cap_style=2, join_style=2), 1) for g, p in roads if tunnel_name in (p['name'] or '').lower()]
    report = {}
    for size, t, suffix in [(FINE, tx, '_fine'), (m.n, m.grid, '')]:
        wet = np.asarray(Image.open(m.base / f'water{suffix}.png')) > 0
        r = m.burn(surface, size, t)
        r[(r > 0) & wet] = 3
        r[(m.burn(tunnels, size, t) > 0) & (r == 0)] = 4
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
    biome = np.zeros((FINE, FINE), np.uint8)
    reproject(np.asarray(Image.open(m.base / 'biome.png')), biome, src_transform=m.grid, src_crs=m.crs,
              dst_transform=tx, dst_crs=m.crs, resampling=Resampling.nearest)
    free = (w_fine == 0) & (b_fine == 0) & (r_fine == 0) & (biome != 6)
    rng = np.random.default_rng(rule.get('seed', 7))
    field = nd.gaussian_filter(rng.standard_normal((FINE // 4, FINE // 4)).astype(np.float32), 1.6)
    field = nd.zoom(field, 4, order=1) + .5 * nd.gaussian_filter(rng.standard_normal((FINE, FINE)).astype(np.float32), 3)
    crown = np.zeros((FINE, FINE), bool)
    shares = {}
    for classes, share in [((3, 4, 5), rule['share_of_vegetation']), ((2,), rule['share_of_open'])]:
        where = free & np.isin(biome, classes)
        if where.any():
            crown |= where & (field > np.quantile(field[where], 1 - share))
            shares[str(classes)] = float(crown[where].mean())
    del field
    crown = nd.binary_opening(crown, iterations=1) & free
    fine = crown.astype(np.uint8)
    save(fine, m.base / 'painted_canopy_fine.png')
    base = np.zeros((m.n, m.n), np.uint8)
    reproject(fine, base, src_transform=tx, dst_transform=m.grid, src_crs=m.crs, dst_crs=m.crs, resampling=Resampling.nearest)
    save(edges(m, base, fine), m.base / 'painted_canopy.png')
    (m.base / 'painted_canopy.json').write_text(json.dumps({
        'origin': 'Authored vegetation by rule, not a survey of present-day trees and not traced from a painting.',
        'rule': rule, 'shares_achieved': shares,
        'fine_grid': '8192 pixel areas across map bounds; transform in map.json conventions',
        'base_grid': f'{m.n} vertex samples, 2 m spacing, endpoints included',
        'values': {'0': 'no added crown', '1': 'authored crown'}, 'fine_count': int(fine.sum()), 'base_count': int(base.sum())}, indent=2) + '\n')
    (m.root / 'reports').mkdir(exist_ok=True)
    (m.root / 'reports/canonical-layers.json').write_text(json.dumps(report, indent=2) + '\n')
    print(report, shares, int(base.sum()), 'canopy samples')


if __name__ == '__main__':
    main()
