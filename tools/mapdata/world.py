"""Propose a map's districts and spawn points from its data, for a person to accept: world/proposed.json, and
world/world.json too when the map has none yet or when
--accept is given. city.json's "world" may add district seeds ("places"), restyle districts ("styles") and name the
spawn points' places and what each faces ("spawn_places"), so the accepted world is still made by this tool. Districts are the cells round OpenStreetMap's named suburbs, quarters,
neighbourhoods and islands (a single default district where it names none), each styled by what its footprints are:
concrete where towers stand, industrial where warehouses do, residential elsewhere. Spawn points are named parks,
beaches and viewpoints on dry land, picked far apart, facing the frame's middle. Run after labels.py.
python tools/mapdata/world.py <map folder> [--accept]"""
import collections
import json
import math
import sys
from pathlib import Path
from pyproj import Transformer
from shapely.geometry import MultiPoint, Point, box
from shapely.ops import voronoi_diagram

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import folder_arg  # noqa: E402

PLACES = ('suburb', 'quarter', 'neighbourhood', 'island', 'islet')
SPAWN_KINDS = {'park': 3, 'garden': 2, 'beach': 3, 'viewpoint': 1, 'marina': 1}


def main():
    m = folder_arg()
    to_lonlat = Transformer.from_crs(m.crs, 4326, always_xy=True)
    to_map = Transformer.from_crs(4326, m.crs, always_xy=True)
    frame = box(*m.b)
    seeds = collections.defaultdict(list)
    for el in json.loads((m.raw / 'osm/all.json').read_text())['elements']:
        t = el.get('tags', {})
        c = el.get('center') or ({'lat': el['lat'], 'lon': el['lon']} if 'lat' in el else None)
        if t.get('place') in PLACES and t.get('name') and c:
            e, n = to_map.transform(c['lon'], c['lat'])
            if frame.contains(Point(e, n)):
                seeds[t['name']].append((e, n))
    settings = m.city.get('world', {})
    for extra in settings.get('places', []):
        seeds[extra['name']] = [to_map.transform(*extra['at'])]
    # Places OpenStreetMap tags as quarters that are not neighbourhoods: an administrative district, an overlay zone.
    for name in settings.get('drop', []):
        seeds.pop(name, None)
    labels = json.loads((m.root / 'blocks/labels.json').read_text())
    # An island or islet is a district only where a footprint stands within 60 m of its middle.
    islands = {el.get('tags', {}).get('name') for el in json.loads((m.raw / 'osm/all.json').read_text())['elements'] if el.get('tags', {}).get('place') in ('island', 'islet')}
    for name in [n for n in seeds if n in islands]:
        e, n = seeds[name][0]
        if not any(math.hypot(v['e'] - e, v['n'] - n) < 60 for v in labels.values()):
            del seeds[name]
    points = sorted((name, (sum(p[0] for p in ps) / len(ps), sum(p[1] for p in ps) / len(ps))) for name, ps in seeds.items())
    cells = []
    if len(points) >= 2:
        diagram = voronoi_diagram(MultiPoint([p for _, p in points]), envelope=frame.buffer(4000))
        for cell in diagram.geoms:
            name = next(nm for nm, p in points if cell.contains(Point(p)))
            cells.append((name, cell.intersection(frame)))
    else:
        cells.append(('City', frame))
    districts = []
    for name, cell in sorted(cells):
        inside = [v for v in labels.values() if cell.contains(Point(v['e'], v['n']))]
        area = sum(v['area_m2'] for v in inside) or 1
        tall = sum(v['area_m2'] for v in inside if (v['height_m'] or 0) >= 32) / area
        works = sum(v['area_m2'] for v in inside if v['kind'] in ('warehouse', 'utility', 'port')) / area
        style = settings.get('styles', {}).get(name) or ('concrete' if tall >= .12 else 'industrial' if works >= .35 else 'residential')
        ring = [[round(c, 5) for c in to_lonlat.transform(x, y)] for x, y in cell.simplify(20).exterior.coords[:-1]]
        districts.append({'name': name, 'style': style, 'tall': round(min(1, max(.1, tall * 3)), 2), 'ring': ring,
                          'footprints': len(inside), 'tall_share': round(tall, 3), 'works_share': round(works, 3)})

    water = m.vectors('areawater')
    from shapely.strtree import STRtree
    wet = STRtree([g for g, _ in water])
    candidates = []
    for p in json.loads((m.root / 'blocks/places.json').read_text()):
        if p['kind'] not in SPAWN_KINDS or not p.get('name') or p.get('in_footprint') is not None:
            continue
        q = Point(p['e'], p['n'])
        if not frame.buffer(-150).contains(q) or any(water[i][0].contains(q) for i in wet.query(q)):
            continue
        candidates.append((SPAWN_KINDS[p['kind']], p))
    chosen, faces = [], {}
    # Places a person named come first, facing what they name; then the best-ranked place nearest the middle, and each
    # next the farthest from those chosen, best kind first.
    for want in settings.get('spawn_places', []):
        name = want if isinstance(want, str) else want['name']
        found = next((p for p in json.loads((m.root / 'blocks/places.json').read_text()) if p.get('name') == name), None)
        if found is None and isinstance(want, dict) and want.get('at'):
            # A place a visitor knows that OpenStreetMap draws no point for, at the position given.
            e, n = to_map.transform(*want['at'])
            found = {'name': name, 'kind': 'park', 'e': e, 'n': n}
        if found is None:
            raise ValueError(f'no place called {name} in blocks/places.json')
        chosen.append(found)
        if isinstance(want, dict) and want.get('face'):
            faces[name] = to_map.transform(*want['face'])
    for _ in range(10 - len(chosen)):
        best, score = None, -1
        for rank, p in candidates:
            gap = min((math.hypot(p['e'] - c['e'], p['n'] - c['n']) for c in chosen), default=4000 - math.hypot(p['e'], p['n']))
            if p in chosen or any(c['name'] == p['name'] for c in chosen):
                continue
            if gap * (1 + .25 * rank) > score:
                best, score = p, gap * (1 + .25 * rank)
        if best is None:
            break
        chosen.append(best)
    spawns = []
    # The survivor's choosing list carries each name in at most 48 bytes (MAX_PLACE_NAME_BYTES); the server cuts a longer one.
    long = [p['name'] for p in chosen if len(p['name'].encode()) > 48]
    if long:
        raise ValueError(f'spawn point names over 48 bytes: {long}; name them shorter in spawn_places with "at"')
    for p in chosen:
        d = math.hypot(p['e'], p['n']) or 1
        face = faces.get(p['name']) or (p['e'] - p['e'] / d * 300, p['n'] - p['n'] / d * 300)
        spawns.append({'name': p['name'], 'at': [round(c, 4) for c in to_lonlat.transform(p['e'], p['n'])],
                       'face': [round(c, 4) for c in to_lonlat.transform(*face)], 'ground': 'sand' if p['kind'] == 'beach' else 'open'})
    proposal = {'districts': districts, 'spawns': spawns,
                'how': 'districts: Voronoi cells of OpenStreetMap places (suburb, quarter, neighbourhood, island) clipped to the frame; '
                       'style concrete where footprints of 32 m or more cover 12% of the built area, industrial where warehouses cover 35%, else residential. '
                       'spawns: named parks, gardens, beaches, viewpoints and marinas on land, farthest-first, facing the middle'}
    (m.root / 'world').mkdir(exist_ok=True)
    (m.root / 'world/proposed.json').write_text(json.dumps(proposal, indent=1, ensure_ascii=False) + '\n')
    path = m.root / 'world/world.json'
    if not path.exists() or '--accept' in sys.argv:
        settings = m.city.get('world', {})
        world = {'id': f"core:{m.city['name']}", 'label': m.city['label'], 'seaNavd88': settings.get('seaNavd88', .3),
                 'minY': settings.get('minY', -32), 'stepY': .015625, 'heaps': False, 'containerHeaps': False,
                 'districts': [{k: d[k] for k in ('name', 'style', 'tall', 'ring')} for d in districts], 'spawns': spawns,
                 # Read by the generator from Miami's third round on: the authored gap layer, the report folder, and
                 # the yards and container district a port has (none unless named).
                 'bridgeGapLayer': 'bridge_gaps', 'ruins': {'report': settings.get('report', 'ruins2'), 'yardDistricts': settings.get('yard_districts', [])}}
        if settings.get('container_district'):
            world['containerDistrict'] = settings['container_district']
        if settings.get('sea') is False:
            world['sea'] = False
        if settings.get('easy_around_spawns_m'):
            world['easyAroundSpawns'] = settings['easy_around_spawns_m']
        if settings.get('obelisks'):
            world['obelisks'] = settings['obelisks']
        path.write_text(json.dumps(world, indent=1, ensure_ascii=False) + '\n')
        print('world.json written from the proposal')
    print(len(districts), 'districts proposed:', collections.Counter(d['style'] for d in districts), '|', len(spawns), 'spawns:', [s['name'] for s in spawns])


if __name__ == '__main__':
    main()
