"""The full shapes of a map's bridges, rail viaducts, piers and breakwaters from OpenStreetMap, in the map's own metres:
blocks/ways.json as tools/mapworld/ways.ts reads it. Fetch first (fetch.py osm): raw/osm/ways.json is the Overpass
answer to blocks/ways.overpassql. python tools/mapdata/ways.py <map folder>"""
import collections
import json
import math
import re
import sys
from pathlib import Path
from pyproj import Transformer


def number(v):
    m = re.match(r'\s*([0-9.]+)', v or '')
    try:
        return float(m.group(1)) if m else None
    except ValueError:
        return None


def metres(v):
    m = re.match(r"\s*([0-9.]+)\s*(m|ft|')?", v or '')
    try:
        return round(float(m.group(1)) * (0.3048 if m.group(2) in ('ft', "'") else 1), 1) if m else None
    except ValueError:
        return None


def main():
    root = Path(sys.argv[1]).resolve()
    tm = Transformer.from_crs(4326, json.loads((root / 'map.json').read_text())['crs_wkt'], always_xy=True)
    out, supports, stairs = [], [], []
    for el in json.loads((root / 'raw/osm/ways.json').read_text())['elements']:
        if el['type'] != 'way' or not el.get('geometry'):
            continue
        t = el.get('tags', {})
        pts = [tm.transform(p['lon'], p['lat']) for p in el['geometry']]
        length = round(sum(math.dist(a, b) for a, b in zip(pts, pts[1:])), 1)
        if t.get('man_made') == 'tower' and t.get('tower:type') == 'bridge':
            # A bridge tower mapped in three dimensions: each part a solid between its two heights above the ground.
            supports.append({'id': el['id'], 'kind': 'bridge_tower', 'name': t.get('name'), 'min_height_m': metres(t.get('min_height')) or 0,
                             'height_m': metres(t.get('height')), 'colour': t.get('building:colour') or t.get('colour'),
                             'ring': [[round(x, 1), round(y, 1)] for x, y in pts]})
            continue
        if t.get('highway') == 'steps' and t.get('bridge', 'no') == 'no':
            stairs.append({'id': el['id'], 'name': t.get('name'), 'steps': number(t.get('step_count')), 'incline': t.get('incline'),
                           'length_m': length, 'points': [[round(x, 1), round(y, 1)] for x, y in pts]})
            continue
        if t.get('man_made') == 'pier':
            kind = 'pier'
        elif t.get('man_made') in ('breakwater', 'groyne'):
            kind = 'breakwater'
        elif t.get('man_made') == 'bridge':
            kind = 'bridge_outline'
        elif 'railway' in t and t.get('bridge', 'no') != 'no':
            kind = 'rail_bridge'
        elif 'highway' in t and t.get('bridge', 'no') != 'no':
            kind = 'road_bridge'
        else:
            continue
        layer = t.get('layer')
        out.append({'id': el['id'], 'kind': kind, 'name': t.get('name'), 'class': t.get('highway') or t.get('railway'),
                    'lanes': number(t.get('lanes')), 'layer': int(layer) if layer and re.fullmatch(r'-?\d+', layer) else None,
                    'width_m': metres(t.get('width')), 'closed': len(pts) > 2 and el['geometry'][0] == el['geometry'][-1],
                    'length_m': length, 'structure': t.get('bridge:structure'),
                    'points': [[round(x, 1), round(y, 1)] for x, y in pts]})
    for rows in (out, supports, stairs):
        rows.sort(key=lambda w: w['id'])
    (root / 'blocks/ways.json').write_text(json.dumps(out) + '\n')
    (root / 'blocks/supports.json').write_text(json.dumps(supports) + '\n')
    (root / 'blocks/stairs.json').write_text(json.dumps(stairs) + '\n')
    c = collections.Counter(w['kind'] for w in out)
    km = collections.defaultdict(float)
    for w in out:
        km[w['kind']] += w['length_m'] / 1000
    print(len(out), 'ways:', ', '.join(f'{c[k]} {k} ({km[k]:.1f} km)' for k in c))
    print(len(supports), 'mapped bridge tower parts;', len(stairs), f'stairs ({sum(s["length_m"] for s in stairs) / 1000:.1f} km)')


if __name__ == '__main__':
    main()
