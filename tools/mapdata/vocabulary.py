"""A map's ruins/vocabulary.json, which extends the shared rule library (tools/mapworld/rules/default.json) and copies
none of it: forms, choices, assemblies, street, damage, interiors, the surge's bands, growth and frontage reach every
city at its build. The city keeps its own: the district table (ruins/districts.json, or one row a district of
world.json by its style), its named places' compositions (ruins/compositions.json) and its budgets, which scale with
the footprints: Miami built 100 blocks a footprint and Tampa 66; a city gets 130 a footprint and never less than
Miami's 1.5 M, and a height cap above its tallest label. Its seed, recipes and label tables (categories, styles,
materials, eras, character, periods), surge direction (event), sight corridors (sightlines) and choices of its own
come from ruins/vocabulary.seed.json, which tools/maps/city.ts writes from tools/maps/rules/tables.json with the
city's rules.json over it. Run after world.py, by tools/maps/city.ts.
python tools/mapdata/vocabulary.py <map folder>"""
import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import folder_arg  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
LIBRARY = ROOT / 'tools/mapworld/rules/default.json'
TABLES_FILE = ROOT / 'tools/maps/rules/tables.json'
PALETTES = {
    'concrete': {'finish': ['limestone', 'limestone', 'blue'], 'fallback': 'apartment', 'wall': .78, 'holes': .16, 'infill': 'blue'},
    'residential': {'finish': ['limestone', 'clay', 'mint'], 'fallback': 'house', 'wall': .85, 'holes': .16},
    'terracotta': {'finish': ['clay', 'clay', 'rose'], 'fallback': 'house', 'wall': .85, 'holes': .16},
    'deco': {'finish': ['rose', 'mint', 'limestone'], 'fallback': 'apartment', 'wall': .8, 'holes': .16},
    'mural': {'finish': ['clay', 'rose', 'concrete'], 'fallback': 'shed', 'wall': .78, 'holes': .16},
    'industrial': {'finish': ['rust', 'steel'], 'fallback': 'shed', 'wall': .78, 'holes': .16},
}
MADE = ('districts', 'budgets', 'compositions', 'composed')
TABLES = ('seed', 'recipes', 'categories', 'styles', 'materials', 'eras', 'character', 'periods')


def main():
    m = folder_arg()
    settings = m.city.get('ruins', {})
    library = json.loads(LIBRARY.read_text())
    # The tables every city starts from (tools/maps/rules/tables.json).
    reference = TABLES_FILE
    rules = json.loads(reference.read_text())
    path = m.root / 'ruins/vocabulary.json'
    # The city's tables as tools/maps/city.ts seeds them, the shared tables with its rules.json over them. This stage
    # alone writes ruins/vocabulary.json: where the seed was merged into it, the orchestrator and this stage wrote one
    # file, and a run without this stage built with the seed's budgets (1.5 M pieces where Tampa's are 13.4 M).
    seed = m.root / 'ruins/vocabulary.seed.json'
    # No seed is no city rules, never an empty set of them: a run of an older orchestrator wrote none, and Los Angeles
    # and Las Vegas built without their growth, sightlines and categories.
    if not seed.exists():
        raise SystemExit(f'{seed} is missing: run the city through tools/maps/city.ts, which writes it')
    before = json.loads(seed.read_text())
    world = json.loads((m.root / 'world/world.json').read_text())
    table_path = m.root / 'ruins/districts.json'
    if table_path.exists():
        table = json.loads(table_path.read_text())
    else:
        table = {d['name']: PALETTES.get(d['style'], PALETTES['residential']) for d in world['districts']}
        table['default'] = PALETTES['residential']
    missing = [d['name'] for d in world['districts'] if d['name'] not in table]
    if missing:
        print('districts with no row, taking the default:', missing)
    compositions_path = m.root / 'ruins/compositions.json'
    compositions = json.loads(compositions_path.read_text()) if compositions_path.exists() else {}
    features = json.loads((m.root / 'base/buildings.geojson').read_text())['features']
    footprints = len(features)
    resolve_places(m, features)
    labels = json.loads((m.root / 'blocks/labels.json').read_text())
    tallest = max((v['height_m'] or 0 for v in labels.values()), default=0)
    budgets = dict(rules['budgets'])
    budgets['maxCity'] = max(1_500_000, settings.get('blocks_per_footprint', 130) * footprints)
    budgets['maxHeight'] = max(budgets['maxHeight'], int(math.ceil(tallest / 16) * 16))
    # A city's own budgets, in city.json's "ruins": Las Vegas's towers stand closer than a chunk holds at eight playable floors.
    budgets.update(settings.get('budgets', {}))
    out = {'version': before.get('version', rules.get('version'))}
    out.update({k: before[k] if k in before else rules[k] for k in TABLES})
    out.update({k: v for k, v in before.items() if k not in MADE and k not in out})
    out['compositions'] = compositions
    out['budgets'] = budgets
    out['districts'] = table
    out['composed'] = {'extends': str(LIBRARY.relative_to(ROOT)),
                       'tables_from': 'this vocabulary' if all(k in before for k in TABLES) else str(reference.relative_to(ROOT)),
                       'districts_from': 'ruins/districts.json' if table_path.exists() else 'world.json styles',
                       'compositions_from': 'ruins/compositions.json' if compositions_path.exists() else 'none',
                       'footprints': footprints, 'tallest_label_m': tallest}
    (m.root / 'ruins').mkdir(exist_ok=True)
    path.write_text(json.dumps(out, indent=2, ensure_ascii=False) + '\n')
    print(f"vocabulary: extends {LIBRARY.relative_to(ROOT)}, {len(table)} district rows, {len(compositions)} compositions, budgets {budgets}")


def resolve_places(m, features):
    """A named place may name its OpenStreetMap building ("osm_way", a relation's id negative) rather than a footprint id,
    which moves whenever the split does: its footprint is the largest piece cut from that building, written back here."""
    # The authored copy (tools/maps/city.ts writes it) is read and this stage alone writes the resolved file: when both
    # were one file the orchestrator wrote it back over the footprints on every run, and a build that ran without this
    # stage placed none of the city's named places.
    path = m.root / 'ruins/places.json'
    authored = m.root / 'ruins/places.authored.json'
    # A city with no named places has none to resolve, and the build reads the resolved file all the same.
    places = json.loads(authored.read_text()) if authored.exists() else []
    from shapely.geometry import shape
    pieces = {}
    for f in features:
        p = f['properties']
        if p.get('osm_way') is not None and not p.get('osm_part') and not p.get('parts_remainder'):
            pieces.setdefault(p['osm_way'], []).append((shape(f['geometry']).area, p['id']))
    changed = False
    at_places = [p for p in places if 'osm_way' not in p and 'at' in p]
    if at_places:
        changed |= resolve_by_position(m, features, at_places)
    for place in places:
        if 'osm_way' not in place:
            continue
        found = max(pieces.get(place['osm_way'], []), default=None)
        if found is None:
            raise SystemExit(f"no footprint was cut from OpenStreetMap's {place['osm_way']} for {place['name']}")
        if place.get('footprint') != found[1]:
            place['footprint'] = found[1]
            changed = True
    lost = [p['name'] for p in places if p.get('footprint') is None]
    if lost:
        raise SystemExit(f"places with no footprint in this cut (move its `at` onto the building, or take the place out): {', '.join(lost)}")
    path.write_text(json.dumps(places, indent=2, ensure_ascii=False) + '\n')
    print(f'places: {len(places)} footprints resolved' + (' from their OpenStreetMap buildings' if changed else ''))


def resolve_by_position(m, features, places, reach_m=30):
    """A named place with no OpenStreetMap building names a point ("at", longitude and latitude): its footprint is the
    largest one holding that point, or the nearest within reach_m, found again on every build, since a footprint's id
    is the row USA Structures gave it and a new download, cut or split may give another."""
    from pyproj import Transformer
    from shapely.geometry import Point, shape
    from shapely.strtree import STRtree
    to_map = Transformer.from_crs(4326, m.cfg['crs_proj'], always_xy=True)
    shapes = [shape(f['geometry']) for f in features]
    tree = STRtree(shapes)
    changed = False
    for place in places:
        pt = Point(*to_map.transform(*place['at']))
        holding = [i for i in tree.query(pt) if shapes[i].contains(pt)]
        if holding:
            best = max(holding, key=lambda i: shapes[i].area)
        else:
            best = tree.nearest(pt)
            if shapes[best].distance(pt) > reach_m:
                raise SystemExit(f"{place['name']}: no footprint at or within {reach_m} m of {place['at']}")
        fid = features[best]['properties']['id']
        if place.get('footprint') != fid:
            place['footprint'] = fid
            changed = True
    return changed


if __name__ == '__main__':
    main()
