"""Split USA Structures footprints that hold a row of attached buildings into those buildings, as OpenStreetMap draws
them. USA Structures traces outlines from imagery, so houses sharing walls come out as one footprint a block face long;
on a slope that one footprint is levelled as one floor. Where two or more OpenStreetMap buildings stand inside a
footprint and together cover most of it, each becomes a footprint of its own, cut to the parent's outline, with the
parent's attributes and a PARENT field naming it. OpenStreetMap buildings that USA Structures lacks are added. Run after the attributes step, when city.json's footprints say
"split_by_osm": true. Fetch first (fetch.py osm): raw/osm/buildings.json is the answer to blocks/buildings.overpassql.
python tools/mapdata/split.py <map folder>"""
import json
import sys
from pathlib import Path
from pyproj import Transformer
from shapely import make_valid
from shapely.geometry import Polygon
from shapely.strtree import STRtree

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import folder_arg  # noqa: E402
from prepare import buildings  # noqa: E402

# Ids of split pieces start here: above any USA Structures object id, and four times it still fits an int32.
SPLIT_BASE = 500_000_000
SLIVER_M2 = 8


def metres(v):
    try:
        return float(v.split()[0]) if v else None
    except ValueError:
        return None


def largest(g):
    return max(g.geoms, key=lambda h: h.area) if hasattr(g, 'geoms') else g


def main():
    m = folder_arg()
    rule = m.city['footprints']
    if not rule.get('split_by_osm'):
        print('split: off for this city')
        return
    cover_min = rule.get('split_cover', 0.6)
    usa = buildings(m)
    tm = Transformer.from_crs(4326, m.crs, always_xy=True)
    osm, tags = [], {}
    for el in json.loads((m.raw / 'osm/buildings.json').read_text())['elements']:
        g = el.get('geometry') or []
        if el['type'] != 'way' or len(g) < 4 or g[0] != g[-1]:
            continue
        p = largest(make_valid(Polygon([tm.transform(q['lon'], q['lat']) for q in g])))
        if p.geom_type == 'Polygon' and p.area >= SLIVER_M2:
            osm.append((el['id'], p))
            tags[el['id']] = el.get('tags', {})
    tree = STRtree([p for _, p in osm])
    out, split, pieces_total, rows = [], 0, 0, []
    next_id = SPLIT_BASE
    used = set()
    for g, props in sorted(usa, key=lambda gp: gp[1]['id']):
        inside = sorted((osm[i] for i in tree.query(g) if g.contains(osm[i][1].representative_point())), key=lambda wp: (-wp[1].area, wp[0]))
        used.update(way for way, _ in inside)
        pieces, taken = [], None
        for way, p in inside:
            piece = p.intersection(g)
            if taken is not None:
                piece = piece.difference(taken)
            piece = largest(make_valid(piece)) if not piece.is_empty else piece
            if piece.is_empty or piece.geom_type != 'Polygon' or piece.area < SLIVER_M2:
                continue
            pieces.append((way, piece))
            taken = piece if taken is None else taken.union(piece)
        if len(pieces) < 2 or sum(p.area for _, p in pieces) < cover_min * g.area:
            out.append((g, props))
            continue
        split += 1
        for way, piece in sorted(pieces, key=lambda wp: wp[0]):
            out.append((piece, {'id': next_id, 'parent': props['id'], 'osm_way': way}))
            rows.append((next_id, props['id'], round(piece.area, 1)))
            next_id += 1
            pieces_total += 1
    # Buildings USA Structures lacks, most of them newer than its imagery (San Francisco's tallest among them): an
    # OpenStreetMap outline of 40 m2 or more, on land, that USA Structures' footprints overlap by less than a fifth.
    usa_tree = STRtree([g for g, _ in usa])
    water = m.vectors('areawater')
    wet = STRtree([g for g, _ in water])
    added = 0
    for way, p in sorted(osm, key=lambda wp: wp[0]):
        t = tags[way]
        if way in used or p.area < 40 or t.get('building') in ('roof', 'houseboat', 'construction') or (metres(t.get('height')) or 3) < 2:
            continue
        q = p.representative_point()
        if any(water[i][0].contains(q) for i in wet.query(q)):
            continue
        if sum(usa[i][0].intersection(p).area for i in usa_tree.query(p)) >= .2 * p.area:
            continue
        out.append((p, {'id': next_id, 'parent': None, 'osm_way': way}))
        rows.append((next_id, None, round(p.area, 1)))
        next_id += 1
        added += 1
    m.write_features('buildings', out)

    path = m.base / 'buildings_attributes.json'
    attrs = json.loads(path.read_text())
    fields = attrs['fields'] if 'PARENT' in attrs['fields'] else attrs['fields'] + ['PARENT']
    oid, sq = fields.index('OBJECTID'), fields.index('SQMETERS')
    own = [r + [None] * (len(fields) - len(r)) for r in attrs['rows'] if r[oid] < SPLIT_BASE]
    by_id = {r[oid]: r for r in own}
    derived = []
    source = fields.index('SOURCE') if 'SOURCE' in fields else None
    # A merged footprint's occupancy is the block's. Ordinary fabric (homes, shops, works) describes the whole row, but an
    # institution names one tenant (one school makes a row of houses "Education"), so a piece of such a block takes its
    # kind from OpenStreetMap or its neighbours instead.
    blocked = [fields.index(f) for f in ('OCC_CLS', 'PRIM_OCC', 'SEC_OCC') if f in fields]
    occ = fields.index('OCC_CLS') if 'OCC_CLS' in fields else None
    for piece_id, parent, area in rows:
        r = list(by_id.get(parent) or [None] * len(fields))
        r[oid], r[sq], r[-1] = piece_id, area, parent
        if occ is not None and r[occ] not in ('Residential', 'Commercial', 'Industrial'):
            for k in blocked:
                r[k] = None
        if parent is None and source is not None:
            r[source] = 'OpenStreetMap'
        derived.append(r)
    attrs['fields'], attrs['rows'] = fields, own + derived
    path.write_text(json.dumps(attrs) + '\n')
    print(f'split: {split} of {len(usa)} USA Structures footprints into {pieces_total} OpenStreetMap buildings; {added} OpenStreetMap buildings added; {len(out)} footprints')


if __name__ == '__main__':
    main()
