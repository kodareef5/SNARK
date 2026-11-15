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
from shapely.ops import unary_union
from shapely.strtree import STRtree

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import folder_arg, relation_polygon  # noqa: E402
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
        if el['type'] == 'relation' and el.get('members'):
            # A multipolygon building (Elara, Palms Place), as the way its outer rings draw; a relation's id is kept
            # negative, so it never meets a way of the same number.
            area = relation_polygon(el['members'], tm.transform)
            if area is None:
                continue
            p, key = largest(make_valid(area)), -el['id']
        elif el['type'] != 'way' or len(g) < 4 or g[0] != g[-1]:
            continue
        else:
            p, key = largest(make_valid(Polygon([tm.transform(q['lon'], q['lat']) for q in g]))), el['id']
        if p.geom_type == 'Polygon' and p.area >= SLIVER_M2:
            osm.append((key, p))
            tags[key] = el.get('tags', {})
    tree = STRtree([p for _, p in osm])
    out, split, pieces_total, rows, remainders = [], 0, 0, [], 0
    next_id = SPLIT_BASE
    used = set()
    taller_first = rule.get('split_taller_first', False)

    def tagged_height(way):
        t = tags[way]
        return metres(t.get('height')) or (int(t['building:levels']) * 3.5 if (t.get('building:levels') or '').isdigit() else 0)
    for g, props in sorted(usa, key=lambda gp: gp[1]['id']):
        inside = sorted((osm[i] for i in tree.query(g) if g.contains(osm[i][1].representative_point())), key=lambda wp: (-wp[1].area, wp[0]))
        if taller_first:
            # Where buildings overlap, the taller is cut first (a tower standing through the casino drawn round it), so
            # the lower one does not swallow it; buildings that do not overlap come out the same in any order.
            inside.sort(key=lambda wp: (-tagged_height(wp[0]), -wp[1].area, wp[0]))
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
        covered = sum(p.area for _, p in pieces)
        rest = []
        if pieces and covered < cover_min * g.area and g.area >= rule.get('split_remainder_m2', float('inf')):
            # A large footprint OpenStreetMap only partly draws (a mall round a theatre and a hotel tower) would take its
            # tallest building's height everywhere: its mapped buildings stand apart and what is left keeps the survey's.
            left = g.difference(unary_union([p for _, p in pieces])).buffer(-1.5).buffer(1.5, join_style=2)
            rest = [h for h in getattr(left, 'geoms', [left]) if h.geom_type == 'Polygon' and h.area >= 60]
        if not rest and (len(pieces) < 2 or covered < cover_min * g.area):
            out.append((g, props))
            continue
        split += 1
        # With taller_first, a building standing within a larger one (a hotel tower in its resort) names that host, so a
        # tower OpenStreetMap leaves unnamed is labelled by the resort it belongs to.
        hosts = {}
        if taller_first:
            shapes = dict(inside)
            for way, _ in pieces:
                p = shapes[way]
                best = max(((q.intersection(p).area, w) for w, q in inside if w != way and q.area > p.area), default=(0, None))
                if best[0] > .25 * p.area:
                    hosts[way] = best[1]
        for way, piece in sorted(pieces, key=lambda wp: wp[0]) + [(None, h) for h in sorted(rest, key=lambda h: (h.centroid.x, h.centroid.y))]:
            out.append((piece, {'id': next_id, 'parent': props['id'], 'osm_way': way, **({'host': hosts[way]} if way in hosts else {})}))
            rows.append((next_id, props['id'], round(piece.area, 1)))
            next_id += 1
            pieces_total += 1
        remainders += len(rest)
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
    path = m.base / 'buildings_attributes.json'
    attrs = json.loads(path.read_text())
    by_parts = 0
    if rule.get('split_by_parts'):
        out, rows, next_id, by_parts = split_parts(m, out, rows, next_id, tags, attrs, rule)
    m.write_features('buildings', out)

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
    print(f'split: {split} of {len(usa)} USA Structures footprints into {pieces_total - remainders} OpenStreetMap buildings and {remainders} remainders; {added} OpenStreetMap buildings added; {by_parts} cut into their parts; {len(out)} footprints')


def split_parts(m, out, rows, next_id, tags, attrs, rule):
    """A resort or a casino OpenStreetMap draws as one building holds towers it maps only as building parts. Where the
    parts standing on the ground (no min_height) reach more than a quarter over what the footprint is known to stand
    (its building's height, else the survey's), it is cut into those parts and the podium left round them, which keeps
    the footprint's own height."""
    path = m.raw / 'osm/features.json'
    if not path.exists():
        return out, rows, next_id, 0
    tm = Transformer.from_crs(4326, m.crs, always_xy=True)
    level_m = rule.get('split_parts_level_m', 3.5)

    def height(t):
        h = metres(t.get('height'))
        return h if h else (int(t['building:levels']) * level_m if (t.get('building:levels') or '').isdigit() else None)
    parts = []
    for el in json.loads(path.read_text())['elements']:
        t = el.get('tags', {})
        g = el.get('geometry') or []
        if 'building:part' not in t or el['type'] != 'way' or len(g) < 4 or g[0] != g[-1]:
            continue
        if (metres(t.get('min_height')) or 0) > 0 or (t.get('building:min_level') or '0') not in ('0', ''):
            continue
        p = largest(make_valid(Polygon([tm.transform(q['lon'], q['lat']) for q in g])))
        if p.geom_type == 'Polygon' and p.area >= SLIVER_M2:
            parts.append((el['id'], p, t))
    if not parts:
        return out, rows, next_id, 0
    tree = STRtree([p for _, p, _ in parts])
    oid = attrs['fields'].index('OBJECTID')
    hgt = attrs['fields'].index('HEIGHT') if 'HEIGHT' in attrs['fields'] else None
    survey = {r[oid]: r[hgt] for r in attrs['rows']} if hgt is not None else {}
    least = rule.get('split_remainder_m2', 2000)
    kept, cut = [], 0
    for g, props in out:
        inside = [parts[i] for i in tree.query(g) if g.contains(parts[i][1].representative_point())] if g.area >= least else []
        tallest = max((height(t) or 0 for _, _, t in inside), default=0)
        parent = props.get('parent', props['id']) if props['id'] >= SPLIT_BASE else props['id']
        known = metres((tags.get(props.get('osm_way')) or {}).get('height')) or survey.get(parent)
        if not inside or not tallest or (known and tallest <= 1.25 * float(known)):
            kept.append((g, props))
            continue
        pieces, taken = [], None
        for way, p, _ in sorted(inside, key=lambda wp: (-wp[1].area, wp[0])):
            piece = p.intersection(g)
            if taken is not None:
                piece = piece.difference(taken)
            piece = largest(make_valid(piece)) if not piece.is_empty else piece
            if piece.is_empty or piece.geom_type != 'Polygon' or piece.area < SLIVER_M2:
                continue
            pieces.append((way, piece))
            taken = piece if taken is None else taken.union(piece)
        left = g.difference(taken).buffer(-1.5).buffer(1.5, join_style=2) if taken is not None else g
        rest = [h for h in getattr(left, 'geoms', [left]) if h.geom_type == 'Polygon' and h.area >= 60]
        rows = [r for r in rows if r[0] != props['id']]
        for way, piece in sorted(pieces, key=lambda wp: wp[0]):
            kept.append((piece, {'id': next_id, 'parent': parent, 'osm_way': props.get('osm_way'), 'osm_part': way}))
            rows.append((next_id, parent, round(piece.area, 1)))
            next_id += 1
        for h in sorted(rest, key=lambda h: (h.centroid.x, h.centroid.y)):
            kept.append((h, {'id': next_id, 'parent': parent, 'osm_way': props.get('osm_way'), 'parts_remainder': True}))
            rows.append((next_id, parent, round(h.area, 1)))
            next_id += 1
        cut += 1
    return kept, rows, next_id, cut


if __name__ == '__main__':
    main()
