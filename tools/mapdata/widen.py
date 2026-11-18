"""Lay a map's source into a wider frame round it. python tools/mapdata/widen.py <wider map folder> layers|world

The wider map's city.json names the map it widens ("widens"); the two share one projection, and the narrower frame lies on
the wider one's samples. Run "layers" once the wider frame's own layers are made (prepare, attributes, future, fine,
bathymetry, labels, ways): inside the narrower frame every 2 m layer, footprint, label, place and way is the narrower
map's, and the wider map's own are kept only outside it, so the build grows the same city there (tools/mapworld/base.ts,
Grid). A footprint, way, sign or place of the wider map's that reaches into the narrower frame is left out, and its roads
and water are cut at the frame's edge: the narrower map's own, cut at that edge, stand inside. The fine layers are the
wider map's own; the build does not read them. Run "world" after world.py has proposed districts over the wider frame:
the narrower map's world with the wider map's id and label, and a district for each part of a proposed cell outside the
narrower frame, named for its place, or, where its place is inside, for the narrower district it meets along the edge
and the side it lies on."""
import json
import shutil
import sys
from pathlib import Path
import numpy as np
from PIL import Image
from pyproj import Transformer
from shapely.geometry import Point, Polygon, box, mapping, shape
from shapely.ops import unary_union

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import folder_arg, save  # noqa: E402

Image.MAX_IMAGE_PIXELS = None
SECTOR_CHUNKS = 16
FRAME_MIDDLE = 2048
# The smallest piece of a district outside the narrower frame kept, in square metres: slivers where cells meet the frame.
LEAST_DISTRICT = 2_000


def frames(m):
    old = m.root.parent / m.city['widens']
    a, b = json.loads((old / 'map.json').read_text()), m.cfg
    if a['crs_wkt'] != b['crs_wkt'] or a['spacing_m'] != b['spacing_m']:
        raise SystemExit(f'{old.name} and {m.root.name} are not in one projection at one spacing')
    w, s, e, n = a['bounds']
    col, row = (w - m.b[0]) / a['spacing_m'], (m.b[3] - n) / a['spacing_m']
    if col != int(col) or row != int(row) or w < m.b[0] or s < m.b[1] or e > m.b[2] or n > m.b[3]:
        raise SystemExit(f'{old.name} does not lie on {m.root.name}\'s samples')
    return old, a, box(w, s, e, n), int(col), int(row)


def collection(path):
    return json.loads(path.read_text()) if path.exists() else {'type': 'FeatureCollection', 'features': []}


def layers(m):
    old, info, inside, col, row = frames(m)
    rows, cols = info['grid_samples'][1], info['grid_samples'][0]
    for path in sorted((old / 'base').glob('*.png')):
        if path.stem.endswith('_fine'):
            continue
        a = np.asarray(Image.open(path))
        target = m.base / path.name
        b = np.asarray(Image.open(target)).copy() if target.exists() else np.zeros(m.shape, a.dtype)
        if a.shape != (rows, cols) or b.shape != m.shape or a.dtype != b.dtype:
            raise SystemExit(f'{path.name}: {a.shape} {a.dtype} into {b.shape} {b.dtype}')
        b[row:row + rows, col:col + cols] = a
        save(b, target)
        print('laid', path.name, flush=True)

    # Footprints: the narrower map's, then the wider map's wholly outside it.
    ours = collection(old / 'base/buildings.geojson')
    theirs = collection(m.base / 'buildings.geojson')
    kept = [f for f in theirs['features'] if not shape(f['geometry']).intersects(inside)]
    taken = {f['properties']['id'] for f in ours['features']}
    kept = [f for f in kept if f['properties']['id'] not in taken]
    ids = {str(f['properties']['id']) for f in kept}
    (m.base / 'buildings.geojson').write_text(json.dumps({**theirs, 'features': ours['features'] + kept}, separators=(',', ':')))
    print('footprints', len(ours['features']), 'inside and', len(kept), 'of', len(theirs['features']), 'outside', flush=True)
    a = json.loads((old / 'base/buildings_attributes.json').read_text())
    b = json.loads((m.base / 'buildings_attributes.json').read_text())
    if a['fields'] != b['fields']:
        raise SystemExit('the two maps\' building attributes have other fields')
    at = b['fields'].index('OBJECTID')
    (m.base / 'buildings_attributes.json').write_text(json.dumps({**b, 'rows': a['rows'] + [r for r in b['rows'] if str(r[at]) in ids]}) + '\n')

    # Lines and areas the build or the fine layers read: the narrower map's, then the wider map's cut at its edge.
    for name in ('roads', 'areawater'):
        ours, theirs = collection(old / f'base/{name}.geojson'), collection(m.base / f'{name}.geojson')
        cut = []
        for f in theirs['features']:
            g = shape(f['geometry']).difference(inside)
            if not g.is_empty:
                cut.append({**f, 'geometry': mapping(g)})
        (m.base / f'{name}.geojson').write_text(json.dumps({**theirs, 'features': ours['features'] + cut}, separators=(',', ':')))
        print(name, len(ours['features']), 'inside and', len(cut), 'cut outside', flush=True)
    # What the wider map has that the narrower one did not: only where it stands clear of it.
    for name in ('perched_water', 'paved'):
        theirs = collection(m.base / f'{name}.geojson')
        if theirs['features']:
            clear = [f for f in theirs['features'] if not shape(f['geometry']).intersects(inside)]
            (m.base / f'{name}.geojson').write_text(json.dumps({**theirs, 'features': clear}, separators=(',', ':')))
            print(name, len(clear), 'of', len(theirs['features']), 'clear of the narrower frame', flush=True)
    ours, theirs = collection(old / 'base/future_changes.geojson'), collection(m.base / 'future_changes.geojson')
    (m.base / 'future_changes.geojson').write_text(json.dumps({**theirs, 'features': ours['features'] + theirs['features']}, indent=2) + '\n')

    blocks = m.root / 'blocks'
    labels = json.loads((old / 'blocks/labels.json').read_text())
    for k, v in json.loads((blocks / 'labels.json').read_text()).items():
        if k in ids:
            labels[k] = v
    (blocks / 'labels.json').write_text(json.dumps(labels, indent=1, ensure_ascii=False) + '\n')
    places = json.loads((old / 'blocks/places.json').read_text())
    places += [p for p in json.loads((blocks / 'places.json').read_text()) if not inside.intersects(Point(p['e'], p['n']))]
    (blocks / 'places.json').write_text(json.dumps(places, indent=1, ensure_ascii=False) + '\n')
    print('labels', len(labels), 'places', len(places), flush=True)

    def line(item):
        pts = item.get('points') or item.get('ring')
        return Point(pts[0]) if len(pts) < 2 else shape({'type': 'LineString', 'coordinates': pts})
    for name in ('ways', 'supports', 'signs', 'stairs'):
        ours = json.loads((old / f'blocks/{name}.json').read_text()) if (old / f'blocks/{name}.json').exists() else []
        theirs = json.loads((blocks / f'{name}.json').read_text()) if (blocks / f'{name}.json').exists() else []
        known = {w['id'] for w in ours}
        added = [w for w in theirs if w['id'] not in known and not line(w).intersects(inside)]
        (blocks / f'{name}.json').write_text(json.dumps(ours + added) + '\n')
        print(name, len(ours), 'and', len(added), 'clear of the narrower frame', flush=True)
    # The narrower map's surveys and corrections, which name its footprints.
    for name in ('cells.json', 'out', 'research.json', 'research.schema.json', 'schema.json', 'height-corrections.json', 'height-review.json'):
        src = old / 'blocks' / name
        if src.is_dir():
            shutil.copytree(src, blocks / name, dirs_exist_ok=True)
        elif src.exists():
            shutil.copy2(src, blocks / name)
    (m.root / 'ruins').mkdir(exist_ok=True)
    for name in ('places.json', 'compositions.json', 'captions.json', 'proof.json'):
        if (old / 'ruins' / name).exists():
            shutil.copy2(old / 'ruins' / name, m.root / 'ruins' / name)


def world(m):
    old, info, inside, col, row = frames(m)
    to_lonlat = Transformer.from_crs(m.crs, 4326, always_xy=True)
    to_map = Transformer.from_crs(4326, m.crs, always_xy=True)
    w = json.loads((old / 'world/world.json').read_text())
    proposal = json.loads((m.root / 'world/proposed.json').read_text())
    outside = box(*m.b).difference(inside)
    labels = json.loads((m.root / 'blocks/labels.json').read_text())
    vocabulary = json.loads((old / 'ruins/vocabulary.json').read_text())
    rings = [(d, Polygon([to_map.transform(*p) for p in d['ring']]).buffer(0)) for d in w['districts']]
    pieces = {}
    for d in proposal['districts']:
        cell = Polygon([to_map.transform(*p) for p in d['ring']]).buffer(0).intersection(outside)
        if cell.is_empty:
            continue
        seed = Point(to_map.transform(*d['at'])) if d.get('at') else cell.centroid
        if not inside.contains(seed):
            pieces.setdefault(d['name'], [[], None])[0].append(cell)
            continue
        # A cell whose place is inside the narrower frame runs on past it: each of its pieces is named for the narrower
        # district it meets along the frame's edge most, and the side it lies on, and is built as that district is.
        for g in getattr(cell, 'geoms', [cell]):
            parent = max(rings, key=lambda xg: g.boundary.intersection(xg[1].buffer(1)).length)[0]
            c = g.centroid
            side = 'North' if c.y > inside.bounds[3] else 'South' if c.y < inside.bounds[1] else 'East' if c.x > inside.bounds[2] else 'West'
            name = f"{parent['name']} {side}"
            if parent['name'] in vocabulary['districts']:
                vocabulary['districts'][name] = vocabulary['districts'][parent['name']]
            pieces.setdefault(name, [[], parent])[0].append(g)
    added = []
    for name, (cells, parent) in pieces.items():
        whole = unary_union(cells)
        for g in [g for g in getattr(whole, 'geoms', [whole]) if g.geom_type == 'Polygon' and g.area >= LEAST_DISTRICT]:
            if parent:
                style, tall = parent['style'], parent['tall']
            else:
                within = [v for v in labels.values() if g.contains(Point(v['e'], v['n']))]
                area = sum(v['area_m2'] for v in within) or 1
                tall_share = sum(v['area_m2'] for v in within if (v['height_m'] or 0) >= 32) / area
                works = sum(v['area_m2'] for v in within if v['kind'] in ('warehouse', 'utility', 'port')) / area
                style = 'concrete' if tall_share >= .12 else 'industrial' if works >= .35 else 'residential'
                tall = round(min(1, max(.1, tall_share * 3)), 2)
            ring = [[round(v, 5) for v in to_lonlat.transform(x, y)] for x, y in g.simplify(20).exterior.coords[:-1]]
            added.append({'name': name, 'style': style, 'tall': tall, 'ring': ring})
    # The display origin stays where the narrower map's is.
    def origin(cfg):
        return [-(-(cfg['frame'][k] + cfg['chunks'][k]) // SECTOR_CHUNKS) * SECTOR_CHUNKS for k in (0, 1)]
    was = [o + w.get('room', {}).get(k, 0) * SECTOR_CHUNKS for o, k in zip(origin(info), ('west', 'north'))]
    room = {k: (was[i] - origin(m.cfg)[i]) // SECTOR_CHUNKS for i, k in enumerate(('west', 'north')) if was[i] != origin(m.cfg)[i]}
    out = {**w, 'id': f"core:{m.city['name']}", 'label': m.city['label'], 'room': room, 'districts': w['districts'] + added}
    if m.city.get('world', {}).get('spawns'):
        out['spawns'] = w['spawns'] + m.city['world']['spawns']
    (m.root / 'world/world.json').write_text(json.dumps(out, indent=2, ensure_ascii=False) + '\n')
    footprints = len(json.loads((m.base / 'buildings.geojson').read_text())['features'])
    vocabulary['budgets']['maxCity'] = max(vocabulary['budgets']['maxCity'], 130 * footprints)
    (m.root / 'ruins/vocabulary.json').write_text(json.dumps(vocabulary, indent=2, ensure_ascii=False) + '\n')
    for d in added:
        print('district', d['name'], d['style'], d['tall'], flush=True)
    print('room', room, 'spawns', [s['name'] for s in out['spawns']], 'maxCity', vocabulary['budgets']['maxCity'], flush=True)


if __name__ == '__main__':
    m = folder_arg()
    {'layers': layers, 'world': world}[sys.argv[2]](m)
