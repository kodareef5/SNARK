"""The authored future-world layers, kept apart from the surveyed ones, as tools/mapart/future.py made Miami's but read
from city.json: broken bridge spans by road name, submerged wrecks by position, and road tunnels marked as below the
surface. Run after prepare.py. python tools/mapdata/future.py <map folder>"""
import json
import math
import sys
from pathlib import Path
import numpy as np
from PIL import Image
from shapely.geometry import Polygon, mapping
from shapely.ops import unary_union

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import folder_arg, save  # noqa: E402


def main():
    m = folder_arg()
    roads = m.vectors('roads')
    water = unary_union([g for g, p in m.vectors('areawater')])
    f = m.city['future']
    gaps = []
    for s in f['spans']:
        choices = []
        for g, p in roads:
            if p['name'] != s['road']:
                continue
            wet = g.intersection(water)
            choices.extend(h for h in (wet.geoms if hasattr(wet, 'geoms') else [wet]) if h.geom_type == 'LineString')
        if not choices:
            raise ValueError(f"no stretch of {s['road']} over water")
        line = max(choices, key=lambda h: h.length)
        at = line.length * s.get('at', .53)
        c, p1, p2 = line.interpolate(at), line.interpolate(at - 1), line.interpolate(at + 1)
        dx, dy = p2.x - p1.x, p2.y - p1.y
        norm = math.hypot(dx, dy)
        dx, dy = dx / norm, dy / norm
        length, width = s['length_m'], s['width_m']
        poly = Polygon([(c.x + u * dx - v * dy, c.y + u * dy + v * dx) for u, v in
                        [(-length / 2, -width / 2), (length / 2, -width / 2), (length / 2, width / 2), (-length / 2, width / 2)]])
        gaps.append((poly.intersection(water), {'kind': 'missing_bridge_span', 'causeway': s['road'], 'length_m': length,
                                                'authored': True, 'why': s.get('why')}))
    wrecks = []
    for i, w in enumerate(f['wrecks']):
        x, y, length, width = w['e'], w['n'], w['length_m'], w['width_m']
        theta = math.radians(w['angle_degrees'])
        dx, dy = math.cos(theta), math.sin(theta)
        poly = Polygon([(x + u * dx - v * dy, y + u * dy + v * dx) for u, v in
                        [(-length / 2, -width / 2), (length * .35, -width / 2), (length / 2, 0), (length * .35, width / 2), (-length / 2, width / 2)]])
        if not water.contains(poly):
            raise ValueError(f'wreck {i} is not wholly in the water')
        wrecks.append((poly, {'kind': 'submerged_wreck', 'id': i, 'authored': True, 'length_m': length, 'width_m': width,
                              'angle_degrees': w['angle_degrees'], 'center': [x, y], 'why': w.get('why')}))
    (m.base / 'future_changes.geojson').write_text(json.dumps({
        'type': 'FeatureCollection', 'crs': {'type': 'name', 'properties': {'name': m.cfg['crs_proj']}},
        'features': [{'type': 'Feature', 'geometry': mapping(g), 'properties': p} for g, p in gaps + wrecks]}, indent=2) + '\n')
    save(m.burn([(g, 1) for g, p in gaps], m.n, m.grid), m.base / 'bridge_gaps.png')
    save(m.burn([(g, 1) for g, p in wrecks], m.n, m.grid), m.base / 'wrecks.png')
    rd = np.array(Image.open(m.base / 'roads.png'))
    tunnel_name = m.city['roads']['tunnel_name']
    tunnel = m.burn([(g.buffer(p['width_m'] / 2, cap_style=2), 1) for g, p in roads if tunnel_name in (p['name'] or '').lower()], m.n, m.grid) > 0
    rd[tunnel] = 4
    gap = np.array(Image.open(m.base / 'bridge_gaps.png')) > 0
    rd[gap & (rd == 3)] = 5
    save(rd, m.base / 'roads.png')
    print(f'{len(gaps)} missing spans, {len(wrecks)} submerged wrecks, {int(tunnel.sum())} tunnel samples')


if __name__ == '__main__':
    main()
