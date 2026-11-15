"""A map's ruins/vocabulary.json from the city-neutral rules and the city's own tables. The rule sections (forms,
choices, assemblies, street, damage, interiors, categories, styles, eras and the rest) are the reference map's, Miami's
unless city.json's "ruins" names another, so a change to them reaches every city when its vocabulary is made again.
The city keeps its own: the district table (ruins/districts.json, or one row a district of world.json by its style),
its recipes (as its vocabulary has them, the reference's for a new city), its named places' compositions
(ruins/compositions.json; the reference's are its own places) and its budgets, which scale with the footprints: Miami
built 100 blocks a footprint and Tampa 66; a city gets 130 a footprint and never less than Miami's 1.5 M, and a height
cap above its tallest label. Run after world.py. python tools/mapdata/vocabulary.py <map folder>"""
import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import folder_arg  # noqa: E402

PALETTES = {
    'concrete': {'finish': ['limestone', 'limestone', 'blue'], 'fallback': 'apartment', 'wall': .78, 'holes': .16, 'infill': 'blue'},
    'residential': {'finish': ['limestone', 'clay', 'mint'], 'fallback': 'house', 'wall': .85, 'holes': .16},
    'terracotta': {'finish': ['clay', 'clay', 'rose'], 'fallback': 'house', 'wall': .85, 'holes': .16},
    'deco': {'finish': ['rose', 'mint', 'limestone'], 'fallback': 'apartment', 'wall': .8, 'holes': .16},
    'mural': {'finish': ['clay', 'rose', 'concrete'], 'fallback': 'shed', 'wall': .78, 'holes': .16},
    'industrial': {'finish': ['rust', 'steel'], 'fallback': 'shed', 'wall': .78, 'holes': .16},
}
OWN = ('districts', 'budgets', 'recipes', 'compositions', 'composed')


def main():
    m = folder_arg()
    settings = m.city.get('ruins', {})
    reference = m.root.parent / settings.get('rules_from', 'miami') / 'ruins/vocabulary.json'
    rules = json.loads(reference.read_text())
    path = m.root / 'ruins/vocabulary.json'
    before = json.loads(path.read_text()) if path.exists() else {}
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
    footprints = len(json.loads((m.root / 'base/buildings.geojson').read_text())['features'])
    labels = json.loads((m.root / 'blocks/labels.json').read_text())
    tallest = max((v['height_m'] or 0 for v in labels.values()), default=0)
    budgets = dict(rules['budgets'])
    budgets['maxCity'] = max(1_500_000, settings.get('blocks_per_footprint', 130) * footprints)
    budgets['maxHeight'] = max(budgets['maxHeight'], int(math.ceil(tallest / 16) * 16))
    out = {k: v for k, v in rules.items() if k not in OWN}
    out['recipes'] = before.get('recipes') or rules['recipes']
    out['compositions'] = compositions
    out['budgets'] = budgets
    out['districts'] = table
    out['composed'] = {'rules_from': str(reference.relative_to(m.root.parent.parent.parent.parent)), 'rules_version': rules.get('version'),
                       'districts_from': 'ruins/districts.json' if table_path.exists() else 'world.json styles',
                       'recipes_from': 'this vocabulary' if before.get('recipes') else 'the reference',
                       'compositions_from': 'ruins/compositions.json' if compositions_path.exists() else 'none',
                       'footprints': footprints, 'tallest_label_m': tallest}
    (m.root / 'ruins').mkdir(exist_ok=True)
    path.write_text(json.dumps(out, indent=2, ensure_ascii=False) + '\n')
    print(f"vocabulary: {reference.parent.parent.name}'s rules (version {rules.get('version')}), {len(table)} district rows, {len(compositions)} compositions, budgets {budgets}")


if __name__ == '__main__':
    main()
