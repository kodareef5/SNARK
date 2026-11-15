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
    out = []
    for el in json.loads((root / 'raw/osm/ways.json').read_text())['elements']:
        if el['type'] != 'way' or not el.get('geometry'):
            continue
        t = el.get('tags', {})
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
        pts = [tm.transform(p['lon'], p['lat']) for p in el['geometry']]
        layer = t.get('layer')
        out.append({'id': el['id'], 'kind': kind, 'name': t.get('name'), 'class': t.get('highway') or t.get('railway'),
                    'lanes': number(t.get('lanes')), 'layer': int(layer) if layer and re.fullmatch(r'-?\d+', layer) else None,
                    'width_m': metres(t.get('width')), 'closed': len(pts) > 2 and el['geometry'][0] == el['geometry'][-1],
                    'length_m': round(sum(math.dist(a, b) for a, b in zip(pts, pts[1:])), 1),
                    'points': [[round(x, 1), round(y, 1)] for x, y in pts]})
    out.sort(key=lambda w: w['id'])
    (root / 'blocks/ways.json').write_text(json.dumps(out) + '\n')
    c = collections.Counter(w['kind'] for w in out)
    km = collections.defaultdict(float)
    for w in out:
        km[w['kind']] += w['length_m'] / 1000
    print(len(out), 'ways:', ', '.join(f'{c[k]} {k} ({km[k]:.1f} km)' for k in c))


if __name__ == '__main__':
    main()
