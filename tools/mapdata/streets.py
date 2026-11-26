"""A city's streets from OpenStreetMap, for prepare.py: the roads it burns, and what the ground is used for beside them.

Roads are OpenStreetMap's highways (raw/osm/streets.json, fetch.py), drawn over imagery: TIGER's centrelines, which the
map took before, wander metres off the kerb and carry a width for their class alone. A road keeps the form prepare.py
burns (an id, a TIGER class, a name, a width) and adds what OpenStreetMap says of it: lanes, one way, the TIGER name it
runs along, bridge and tunnel, its speed limit in mph, whether it is lit, its surface and the kerb parking each side of
its drawn direction, and which way a one-way street runs against that direction (oneway_dir). Signals, stops,
give-ways and crossings go to `controls.json`, each with the pieces and directions of the traffic it governs (a
crossing with its crossing=* and markings), so the street furniture can stand signs and signal heads where they are
mapped. Its width is its tagged width, else its lanes at 3.3 m and its kerb space; its stretch
between two junctions is drawn straight where it never strays a metre from the straight line. A TIGER road stays where
OpenStreetMap draws none along it.

Beside the roads (`walks.geojson`, `areas.geojson`, `stalls.json`, `use.png`): sidewalks as drawn, and on a street with
none drawn and none tagged absent, one each side past the kerb; crossings as drawn, and across the road at a crossing
or signal point with none drawn; footways, paths, pedestrian streets and steps; parking lots, with a stall each 2.7 m
along both sides of each aisle; parks, pitches, playgrounds and plazas; land use. `streets.json` counts what was drawn
and what was made by rule, and how much of each network one piece holds."""
import json
import math
import re
from collections import Counter, defaultdict
import numpy as np
from pyproj import Transformer
from shapely import make_valid
from shapely.geometry import LineString, Point, Polygon, box, mapping
from shapely.ops import unary_union
from shapely.strtree import STRtree

from common import relation_polygon, save

# OpenStreetMap's drivable classes as TIGER's (which the build's street logic reads: S1100 and S1200 are highway
# ground, S1400 a street, S1780 a lot's road), and the lanes and kerb space a two-way road of the class has untagged.
DRIVE = {
    'motorway': ('S1100', 2, 3), 'trunk': ('S1200', 4, 2), 'primary': ('S1200', 4, 2), 'secondary': ('S1400', 4, 2),
    'tertiary': ('S1400', 2, 2), 'unclassified': ('S1400', 2, 2), 'residential': ('S1400', 2, 2), 'living_street': ('S1400', 1, 2),
    'road': ('S1400', 2, 2), 'motorway_link': ('S1630', 1, 2), 'trunk_link': ('S1630', 1, 2), 'primary_link': ('S1630', 1, 2),
    'secondary_link': ('S1400', 1, 2), 'tertiary_link': ('S1400', 1, 2), 'service': ('S1640', 1, 2), 'track': ('S1500', 1, 1),
}
# Service roads a lot or a house keeps to itself are its ground, not the city's streets.
PRIVATE_SERVICE = ('driveway', 'drive-through', 'emergency_access')
LANE_M = 3.3
# Streets a sidewalk runs along unless OpenStreetMap says none does.
WALKED = ('primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'primary_link', 'secondary_link', 'tertiary_link')
WALK_WIDTH = {'sidewalk': 2.5, 'crossing': 3.0, 'footway': 2.5, 'path': 2.0, 'pedestrian': 4.0, 'cycleway': 2.0, 'steps': 2.0}
# use.png's values, burned in this order so the later wins: what a person may walk on over what it lies in.
USE = {'park': 6, 'pitch': 7, 'lot': 5, 'plaza': 4, 'path': 3, 'sidewalk': 1, 'crossing': 2}
STALL_EVERY, STALL_DEPTH, STALL_WIDTH, AISLE_HALF = 2.7, 5.0, 2.5, 3.0
CORNER_REACH = 10.0
# A stretch between junctions is drawn straight where no point strays further from its chord, and it is this long.
STRAIGHT_WITHIN, STRAIGHT_LONGER = 1.0, 15.0


def number(v):
    m = re.match(r'^\s*([\d.]+)\s*(m|ft|\'|)?', str(v or ''))
    if not m:
        return None
    x = float(m.group(1))
    return x * .3048 if m.group(2) in ('ft', "'") else x


def mph(v):
    """A maxspeed as miles an hour: US cities tag '35 mph'; a bare number is km/h by OpenStreetMap's rule."""
    m = re.match(r'^\s*(\d+(?:\.\d+)?)\s*(mph|km/h|kmh)?\s*$', str(v or ''))
    if not m:
        return None
    x = float(m.group(1))
    return round(x if m.group(2) == 'mph' else x / 1.609344)


# Kerb parking, both of OpenStreetMap's schemes, as how cars stand: the old parking:lane:<side>=parallel|diagonal|
# perpendicular|no_*, and the new parking:<side>=lane|street_side|on_kerb|half_on_kerb|no|separate with
# parking:<side>:orientation. 'no' where it is tagged absent, None where nothing is said.
PARKED = {'parallel': 'parallel', 'diagonal': 'diagonal', 'perpendicular': 'perpendicular', 'marked': 'parallel'}
NOT_PARKED = ('no', 'no_parking', 'no_stopping', 'no_standing', 'fire_lane', 'separate')


def parking(t, side):
    for key in (f'parking:{side}', 'parking:both'):
        v = t.get(key)
        if v in NOT_PARKED:
            return 'no'
        if v:
            return PARKED.get(t.get(f'{key}:orientation'), 'parallel')
    for key in (f'parking:lane:{side}', 'parking:lane:both'):
        v = t.get(key)
        if v in NOT_PARKED:
            return 'no'
        if v:
            return PARKED.get(v, 'parallel')
    return None


def lit(v):
    return None if v is None else v not in ('no', 'disused')


CONTROLS = ('traffic_signals', 'stop', 'give_way', 'crossing')


def controls(m, elements, ways, cut, kept):
    """controls.json: each signal, stop, give-way and crossing point, where it stands and the traffic it governs.

    `approaches` are the movements toward the point the control is for, each the road piece the traffic is on (an id of
    roads.geojson) and the way it travels there (a unit vector, east and north): what a sign or a signal head faces.
    OpenStreetMap's direction=forward|backward (or traffic_signals:direction) picks one side of the way the point is on;
    with none, every way through it gives its approaches, one way roads only the one traffic drives. A point where ways
    meet is a junction: a stop there without a direction is OpenStreetMap's ambiguous one, kept with every approach.
    A crossing keeps its crossing=* (traffic_signals, marked, uncontrolled, unmarked, ...) and crossing:markings, so a
    pedestrian-crossing sign can go only where no signal controls a marked one; other kinds have them None."""
    to_map = Transformer.from_crs(4326, m.crs, always_xy=True).transform
    frame = box(*m.b)
    points = {e['id']: e for e in elements if e['type'] == 'node' and e.get('tags', {}).get('highway') in CONTROLS}
    through = defaultdict(list)  # node id -> (way, index of the node in it)
    for w in ways:
        for i, n in enumerate(w.get('nodes') or []):
            if n in points:
                through[n].append((w, i))
    out = []
    for nid, e in sorted(points.items()):
        x, y = to_map(e['lon'], e['lat'])
        if not frame.contains(Point(x, y)):
            continue
        t = e['tags']
        direction = t.get('direction') or t.get('traffic_signals:direction')
        approaches = []
        for w, i in through[nid]:
            pts, (cuts, oneway) = [to_map(p['lon'], p['lat']) for p in w['geometry']], cut[w['id']]
            # The piece a stretch of the way lies in: the last cut at or before its start.
            piece = lambda a: f"osm:{w['id']}:{max(k for k, c in enumerate(cuts[:-1]) if c <= a)}"
            sides = {'forward': ('f',), 'backward': ('b',)}.get(direction, ('f', 'b'))
            if direction not in ('forward', 'backward') and oneway:
                sides = ('b',) if oneway < 0 else ('f',)
            for s in sides:
                j = i - 1 if s == 'f' else i + 1
                if not 0 <= j < len(pts):
                    continue
                dx, dy = pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]
                n = math.hypot(dx, dy)
                if n and piece(min(i, j)) in kept:  # a piece outside the frame, or under half a metre, is not drawn
                    approaches.append({'road': piece(min(i, j)), 'travel': [round(dx / n, 3), round(dy / n, 3)]})
        out.append({'kind': {'traffic_signals': 'signal'}.get(t['highway'], t['highway']), 'osm': nid, 'e': round(x, 2), 'n': round(y, 2),
                    'at': [round(e['lon'], 7), round(e['lat'], 7)], 'direction': direction, 'all_way': t.get('stop') == 'all',
                    'junction': len(through[nid]) > 1 or any(0 < i < len(w['nodes']) - 1 and i in cut[w['id']][0] for w, i in through[nid]),
                    'crossing': t.get('crossing') if t['highway'] == 'crossing' else None,
                    'markings': t.get('crossing:markings') if t['highway'] == 'crossing' else None, 'approaches': approaches})
    (m.base / 'controls.json').write_text(json.dumps(out, separators=(',', ':')) + '\n')
    return {**Counter(c['kind'] for c in out), 'with_no_approach': sum(1 for c in out if not c['approaches'])}


def read(m):
    path = m.raw / 'osm/streets.json'
    return json.loads(path.read_text())['elements'] if path.exists() else None


def straighten(pts, ends):
    """A way's points cut at its junctions (`ends`, indexes), each stretch its chord where it never strays a metre."""
    out, kept = [], 0
    for a, b in zip(ends, ends[1:]):
        seg = pts[a:b + 1]
        if len(seg) < 2:
            continue
        line = LineString(seg)
        chord = LineString([seg[0], seg[-1]])
        if len(seg) > 2 and chord.length >= STRAIGHT_LONGER and max(chord.distance(Point(p)) for p in seg[1:-1]) < STRAIGHT_WITHIN:
            out.append(chord)
            kept += 1
        else:
            out.append(line.simplify(.3))
    return out, kept


def run_starts(whole, g):
    """Metres along the whole piece where each run of `g`, its part the frame holds, starts, so stations along it stand
    where another cut's do: one for each run of a piece that leaves the frame and comes back, [0.0] for one it holds whole."""
    if g.length >= whole.length - 1e-6:
        return [0.0]
    return [round(whole.project(Point(r.coords[0])), 3) for r in (g.geoms if hasattr(g, 'geoms') else [g])]


def levels(text):
    """The floors a level or a layer tag names ('1', '0;1', '-1', '0-2' for 0 to 2), none where it names none."""
    out = []
    for part in re.split(r'[;,]', text or ''):
        span = re.fullmatch(r'\s*(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)\s*', part)
        try:
            ends = [float(span[1]), float(span[2])] if span else [float(part)]
        except ValueError:
            continue
        # A span across the ground's floor holds it.
        out += ends + ([0.0] if len(ends) == 2 and ends[0] < 0 < ends[1] else [])
    return out


def parking_buildings(buildings, to_map):
    """OpenStreetMap's multi-storey car parks (raw/osm/buildings.json's elements) as an index of their shapes, None for none."""
    shapes = []
    for el in buildings:
        t = el.get('tags') or {}
        if t.get('parking') != 'multi-storey' and t.get('building') != 'parking':
            continue
        g = el.get('geometry') or []
        area = relation_polygon(el.get('members') or [], to_map) if el['type'] == 'relation' else Polygon([to_map(q['lon'], q['lat']) for q in g]) if len(g) >= 4 else None
        if area is not None and not area.is_empty:
            shapes.append(make_valid(area))
    return STRtree(shapes) if shapes else None


def off_ground(tags, pts, garages):
    """Why a way is no street on the ground, or None: 'level' or 'layer' where its tag puts it on a floor or a layer
    that is not the ground's, 'parking' for an aisle more than half inside a multi-storey car park. A bridge or a tunnel
    is neither: those stand or are hidden by their own rules (prepare.py, tunnels.py), a building passage with them. Nor
    is any way but a service road: a main road tagged a layer and no bridge (22 of Las Vegas's) is a street all the same."""
    if tags.get('highway') != 'service' or tags.get('bridge') not in (None, 'no') or tags.get('tunnel') not in (None, 'no'):
        return None
    for key in ('level', 'layer'):
        floors = levels(tags.get(key))
        if floors and 0 not in floors:
            return key
    if tags.get('service') == 'parking_aisle' and garages is not None and len(pts) >= 2:
        line = LineString(pts)
        if sum(line.intersection(garages.geometries[i]).length for i in garages.query(line)) > line.length / 2:
            return 'parking'
    return None


def roads(m, elements, tiger_roads):
    """The roads to burn: OpenStreetMap's, cut at junctions and straightened, and TIGER's where OpenStreetMap has none."""
    to_map = Transformer.from_crs(4326, m.crs, always_xy=True).transform
    frame = box(*m.b)
    ways = [e for e in elements if e['type'] == 'way' and e.get('tags', {}).get('highway') in DRIVE and 'geometry' in e]
    ways = [w for w in ways if not (w['tags']['highway'] == 'service' and w['tags'].get('service') in PRIVATE_SERVICE)
            and w['tags'].get('area') != 'yes' and w['tags'].get('access') not in ('no', 'private')]
    # A way on a car park's upper deck or an upper floor's drive is no street of the ground: it ran through the walls of
    # the building it is in. Left out before the junctions are counted, so it cuts no street where it met one.
    path = m.raw / 'osm/buildings.json'
    garages = parking_buildings(json.loads(path.read_text())['elements'], to_map) if path.exists() else None
    why = [off_ground(w['tags'], [to_map(q['lon'], q['lat']) for q in w['geometry']] if w['tags'].get('service') == 'parking_aisle' else [], garages) for w in ways]
    left = Counter(r for r in why if r)
    ways = [w for w, r in zip(ways, why) if not r]
    uses = Counter(n for w in ways for n in w.get('nodes', []))
    tiger_tree = STRtree([g for g, _ in tiger_roads]) if tiger_roads else None
    out, straightened, cut = [], 0, {}
    for w in ways:
        t = w['tags']
        mtfcc, lanes0, kerb = DRIVE[t['highway']]
        if t['highway'] == 'service':
            mtfcc = {'parking_aisle': 'S1780', 'alley': 'S1730'}.get(t.get('service'), 'S1640')
        oneway = t.get('oneway') in ('yes', '1', 'true', '-1') or t['highway'] in ('motorway', 'motorway_link') or t.get('junction') == 'roundabout'
        lanes = number(t.get('lanes'))
        lanes = lanes if lanes and 1 <= lanes <= 12 else max(1, lanes0 // 2) if oneway and lanes0 > 1 else lanes0
        width = number(t.get('width'))
        width = width if width and 2 <= width <= 60 else round(lanes * LANE_M + kerb, 1)
        pts = [to_map(p['lon'], p['lat']) for p in w['geometry']]
        nodes = w.get('nodes') or []
        ends = [0] + [i for i in range(1, len(pts) - 1) if i < len(nodes) and uses[nodes[i]] > 1] + [len(pts) - 1]
        cut[w['id']] = (ends, -1 if t.get('oneway') == '-1' else 1 if oneway else 0)
        pieces, kept = straighten(pts, ends)
        straightened += kept
        for k, whole in enumerate(pieces):
            g = whole.intersection(frame)
            if g.is_empty or g.length < .5:
                continue
            starts = run_starts(whole, g)
            from_m = starts[0]
            tiger_name = None
            if tiger_tree is not None:
                mid = g.interpolate(.5, normalized=True)
                near = [i for i in tiger_tree.query(mid.buffer(12)) if tiger_roads[i][0].distance(mid) < 12]
                if near:
                    tiger_name = tiger_roads[min(near, key=lambda i: (tiger_roads[i][0].distance(mid), tiger_roads[i][0].wkb))][1].get('name')
            out.append((g, {'id': f"osm:{w['id']}:{k}", 'from_m': from_m, **({'runs_from_m': starts} if len(starts) > 1 else {}), 'mtfcc': mtfcc, 'name': t.get('name') or tiger_name, 'tiger_name': tiger_name,
                            # oneway_dir: 1 one way along the drawn direction, -1 against it (OpenStreetMap's oneway=-1), 0 both.
                            'highway': t['highway'], 'lanes': lanes, 'oneway': oneway, 'oneway_dir': cut[w['id']][1], 'width_m': width,
                            'bridge': t.get('bridge') not in (None, 'no'), 'tunnel': t.get('tunnel') == 'yes',  # a building passage runs at the street's own level
                            'tunnel_name': t.get('tunnel:name'),
                            'sidewalk': t.get('sidewalk'), 'layer': number(t.get('layer')) or 0,
                            # Left and right of the way's drawn direction, which its line keeps.
                            'maxspeed_mph': mph(t.get('maxspeed')), 'lit': lit(t.get('lit')), 'surface': t.get('surface'),
                            'parking_left': parking(t, 'left'), 'parking_right': parking(t, 'right')}))
    # TIGER where OpenStreetMap draws no road along it: a line less than a third of which lies near an OpenStreetMap road.
    kept_tiger = []
    if tiger_roads and out:
        # Each TIGER line against the union of the OpenStreetMap roads' reaches that touch it, found by an index: against
        # the union of every one (a single shape of some 100,000 parts) it was 780 of Las Vegas's 1,200 s of prepare.
        reach = [g.buffer(max(10, p['width_m'])) for g, p in out]
        reach_tree = STRtree(reach)
        for g, p in tiger_roads:
            if not g.length:
                continue
            touching = [reach[i] for i in reach_tree.query(g, predicate='intersects')]
            covered = g.intersection(unary_union(touching)).length if touching else 0.0
            if covered / g.length < 1 / 3:
                kept_tiger.append((g, {**p, 'tiger_name': p.get('name'), 'oneway_dir': 0, 'maxspeed_mph': None, 'lit': None, 'surface': None,
                                       'parking_left': None, 'parking_right': None}))
    lines = [g for g, _ in out + kept_tiger for g in getattr(g, 'geoms', [g]) if g.geom_type == 'LineString']
    stats = {'osm_ways': len(ways), 'off_ground_ways': dict(sorted(left.items())), 'road_pieces': len(out), 'straightened': straightened, 'tiger_kept': len(kept_tiger),
             'tiger_lines': len(tiger_roads or []), 'lanes_tagged': sum(1 for w in ways if number(w['tags'].get('lanes'))),
             'oneway': sum(1 for _, p in out if p['oneway']), 'oneway_against_drawn': sum(1 for _, p in out if p['oneway_dir'] < 0), 'road_network_largest_share': connected(lines, 1.0),
             'maxspeed_tagged': sum(1 for _, p in out if p['maxspeed_mph']), 'lit_tagged': sum(1 for _, p in out if p['lit'] is not None),
             'kerb_parking_tagged': sum(1 for _, p in out if p['parking_left'] or p['parking_right']),
             'controls': controls(m, elements, ways, cut, {p['id'] for _, p in out})}
    return out + kept_tiger, stats


def walks(m, elements, road_list):
    """Sidewalks, crossings and paths, drawn and made by rule."""
    to_map = Transformer.from_crs(4326, m.crs, always_xy=True).transform
    frame = box(*m.b)
    drawn, nodes = [], []
    for e in elements:
        t = e.get('tags', {})
        if e['type'] == 'way' and 'geometry' in e:
            hw = t.get('highway')
            if hw in ('footway', 'path', 'pedestrian', 'cycleway', 'steps') and t.get('area') != 'yes':
                kind = t.get('footway') if t.get('footway') in ('sidewalk', 'crossing') else hw if hw != 'path' else 'path'
                g = LineString([to_map(p['lon'], p['lat']) for p in e['geometry']]).intersection(frame)
                if not g.is_empty:
                    drawn.append((g, {'kind': kind, 'drawn': True, 'width_m': WALK_WIDTH.get(kind, 2.5), 'id': f"osm:{e['id']}",
                                      **({'crossing': t.get('crossing'), 'markings': t.get('crossing:markings')} if kind == 'crossing' else {})}))
        elif e['type'] == 'node' and t.get('highway') in ('crossing', 'traffic_signals'):
            x, y = to_map(e['lon'], e['lat'])
            if frame.contains(Point(x, y)):
                nodes.append((Point(x, y), t))
    drawn_side = [g for g, p in drawn if p['kind'] == 'sidewalk']
    side_tree = STRtree(drawn_side) if drawn_side else None
    made = []
    for g, p in road_list:
        if p.get('highway') not in WALKED:
            continue
        tag = p.get('sidewalk')
        if tag in ('no', 'none', 'separate'):
            continue
        sides = {'left': (1,), 'right': (-1,)}.get(tag, (1, -1))
        off = p['width_m'] / 2 + .5 + WALK_WIDTH['sidewalk'] / 2
        for s in sides:
            try:
                line = g.offset_curve(s * off)
            except Exception:
                continue
            if line.is_empty or line.length < 4:
                continue
            # A side whose sidewalk OpenStreetMap draws already: half its length within 4 m of a drawn one.
            if side_tree is not None:
                near = [drawn_side[i] for i in side_tree.query(line.buffer(4))]
                if near and line.intersection(unary_union([d.buffer(4) for d in near])).length > line.length / 2:
                    continue
            made.append((line, {'kind': 'sidewalk', 'drawn': False, 'width_m': WALK_WIDTH['sidewalk'], 'id': f"{p['id']}:{'l' if s > 0 else 'r'}"}))
    # Corners: a sidewalk made along one street stops short of the next street's at the junction, where the offsets of
    # two pieces end apart. Each end of a made one is joined to the nearest other sidewalk within CORNER_REACH, unless it
    # already meets one. On Tampa's square without them the walk network's largest piece held 75% of it.
    every = drawn_side + [g for g, _ in made]
    every_tree = STRtree(every) if every else None
    # The nearest sidewalk can be the one across the street; a join that crosses a road's middle is not a corner.
    centres = [g for g, _ in road_list]
    centre_tree = STRtree(centres) if centres else None
    corners = []
    for k, (g, _) in enumerate(made):
        me = len(drawn_side) + k
        parts = list(g.geoms) if hasattr(g, 'geoms') else [g]
        for end in [Point(q.coords[i]) for q in parts if not q.is_empty for i in (0, -1)]:
            near = [j for j in every_tree.query(end.buffer(CORNER_REACH)) if j != me]
            if not near or any(every[j].distance(end) < 1.0 for j in near):
                continue
            # A tie goes by the shape itself, not by the cut's order of shapes.
            j = min(near, key=lambda j: (every[j].distance(end), every[j].wkb))
            if every[j].distance(end) > CORNER_REACH:
                continue
            join = LineString([end, every[j].interpolate(every[j].project(end))])
            if centre_tree is not None and any(centres[i].intersects(join) for i in centre_tree.query(join)):
                continue
            corners.append((join, {'kind': 'sidewalk', 'drawn': False, 'width_m': WALK_WIDTH['sidewalk'], 'id': f'corner:{round(end.x)}:{round(end.y)}'}))
    made += corners
    # Crossings: at a crossing or signal point with none drawn within 6 m, across the nearest road.
    drawn_cross = [g for g, p in drawn if p['kind'] == 'crossing']
    cross_tree = STRtree(drawn_cross) if drawn_cross else None
    road_geoms = [g for g, _ in road_list]
    road_tree = STRtree(road_geoms)
    for pt, t in nodes:
        if cross_tree is not None and any(drawn_cross[i].distance(pt) < 6 for i in cross_tree.query(pt.buffer(6))):
            continue
        near = [i for i in road_tree.query(pt.buffer(8)) if road_geoms[i].distance(pt) < 8]
        if not near:
            continue
        i = min(near, key=lambda i: (road_geoms[i].distance(pt), str(road_list[i][1].get('id')), road_geoms[i].wkb))
        road, rp = road_geoms[i], road_list[i][1]
        at = road.project(pt)
        a, b = road.interpolate(max(0, at - 1)), road.interpolate(min(road.length, at + 1))
        dx, dy = b.x - a.x, b.y - a.y
        n = math.hypot(dx, dy) or 1
        half = rp['width_m'] / 2 + 1
        c = road.interpolate(at)
        made.append((LineString([(c.x - dy / n * half, c.y + dx / n * half), (c.x + dy / n * half, c.y - dx / n * half)]),
                     {'kind': 'crossing', 'drawn': False, 'width_m': WALK_WIDTH['crossing'], 'id': f"crossing:{round(c.x)}:{round(c.y)}",
                      'signal': t.get('highway') == 'traffic_signals' or t.get('crossing') == 'traffic_signals',
                      'crossing': t.get('crossing'), 'markings': t.get('crossing:markings')}))
    return drawn + made


def polygon_of(e, to_map):
    if e['type'] == 'way' and len(e.get('geometry', [])) >= 4:
        pts = [to_map(p['lon'], p['lat']) for p in e['geometry']]
        if pts[0] == pts[-1]:
            g = make_valid(Polygon(pts))
            return g if not g.is_empty else None
    if e['type'] == 'relation':
        return relation_polygon(e.get('members', []), to_map)
    return None


def areas(m, elements, road_list, footprints):
    """Lots with their stalls, parks, pitches, plazas and land use, as polygons in the map's metres."""
    to_map = Transformer.from_crs(4326, m.crs, always_xy=True).transform
    to_lonlat = Transformer.from_crs(m.crs, 4326, always_xy=True).transform
    frame = box(*m.b)
    out = []
    for e in elements:
        t = e.get('tags', {})
        kind = None
        if t.get('amenity') == 'parking' and t.get('parking') not in ('multi-storey', 'underground', 'rooftop'):
            kind = 'lot'
        elif t.get('leisure') in ('park', 'garden', 'dog_park', 'common', 'recreation_ground'):
            kind = 'park'
        elif t.get('leisure') in ('pitch', 'playground'):
            kind = 'pitch'
        elif t.get('place') == 'square' or (t.get('highway') == 'pedestrian' and t.get('area') == 'yes') or t.get('area:highway') in ('pedestrian', 'footway'):
            kind = 'plaza'
        elif t.get('natural') == 'beach':
            kind = 'beach'
        elif t.get('landuse'):
            kind = 'landuse'
        if not kind:
            continue
        g = polygon_of(e, to_map)
        if g is None:
            continue
        g = g.intersection(frame)
        if g.is_empty or g.area < 20:
            continue
        out.append((g, {'kind': kind, 'id': f"osm:{e['type']}/{e['id']}", 'name': t.get('name'), 'landuse': t.get('landuse'),
                        'surface': t.get('surface')}))
    # Stalls along each lot's aisles, inside the lot and clear of its buildings.
    lots = [(g, p) for g, p in out if p['kind'] == 'lot']
    lot_tree = STRtree([g for g, _ in lots]) if lots else None
    fp_tree = STRtree(footprints) if footprints else None
    stalls = []
    for g, p in road_list:
        if p.get('mtfcc') != 'S1780' or lot_tree is None:
            continue
        for i in lot_tree.query(g):
            lot, lp = lots[i]
            inner = lot.buffer(-.3)
            aisle = g.intersection(lot)
            for part in getattr(aisle, 'geoms', [aisle]):
                if part.geom_type != 'LineString' or part.length < STALL_WIDTH:
                    continue
                d = STALL_EVERY / 2
                while d < part.length:
                    a, b = part.interpolate(max(0, d - .5)), part.interpolate(min(part.length, d + .5))
                    dx, dy = b.x - a.x, b.y - a.y
                    n = math.hypot(dx, dy) or 1
                    ux, uy = dx / n, dy / n
                    c = part.interpolate(d)
                    for side in (1, -1):
                        off = AISLE_HALF + STALL_DEPTH / 2
                        cx, cy = c.x - uy * off * side, c.y + ux * off * side
                        # The stall's rectangle: its depth across the aisle, its width along it.
                        corners = [(cx + ux * su * STALL_WIDTH / 2 - uy * sd * STALL_DEPTH / 2 * side,
                                    cy + uy * su * STALL_WIDTH / 2 + ux * sd * STALL_DEPTH / 2 * side) for su, sd in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
                        rect = Polygon(corners)
                        if not inner.contains(rect):
                            continue
                        if fp_tree is not None and any(footprints[j].intersects(rect) for j in fp_tree.query(rect)):
                            continue
                        # Where it stands and a point 2.5 m toward the aisle, in longitude and latitude: the build turns
                        # both into its own metres (Base.toSample), so the car's nose faces the aisle it drives out by.
                        fx, fy = cx + uy * 2.5 * side, cy - ux * 2.5 * side
                        stalls.append({'lot': lp['id'], 'e': round(cx, 2), 'n': round(cy, 2), 'fe': round(fx, 2), 'fn': round(fy, 2),
                                       'at': [round(v, 7) for v in to_lonlat(cx, cy)], 'face': [round(v, 7) for v in to_lonlat(fx, fy)]})
                    d += STALL_EVERY
    return out, stalls


def connected(lines, snap):
    """The share of the lines' length in the largest piece, their ends joined within `snap` metres."""
    if not lines:
        return 0.0
    parent = list(range(len(lines)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    tree = STRtree(lines)
    for i, g in enumerate(lines):
        for end in (Point(g.coords[0]), Point(g.coords[-1])):
            for j in tree.query(end.buffer(snap)):
                if j != i and lines[j].distance(end) <= snap:
                    parent[find(i)] = find(j)
    total = defaultdict(float)
    for i, g in enumerate(lines):
        total[find(i)] += g.length
    return round(max(total.values()) / sum(total.values()), 3)


def ground_use(m, dims, walk_list, area_list, stalls, stats):
    """use.png at the 2 m samples, and the files and counts the build and a person read."""
    burn = []
    for kind in ('park', 'pitch', 'lot', 'plaza'):
        burn += [(g, USE[kind]) for g, p in area_list if p['kind'] == kind]
    for kind in ('path', 'sidewalk', 'crossing'):
        burn += [(g.buffer(p['width_m'] / 2, cap_style=2), USE[kind]) for g, p in walk_list
                 if (p['kind'] if p['kind'] in ('sidewalk', 'crossing') else 'path') == kind]
    use = m.burn(burn, dims, m.grid)
    save(use, m.base / 'use.png')
    m.write_features('walks', walk_list)
    m.write_features('areas', [(g, p) for g, p in area_list])
    (m.base / 'stalls.json').write_text(json.dumps(stalls, separators=(',', ':')) + '\n')
    kinds = Counter((p['kind'], p['drawn']) for _, p in walk_list)
    walk_lines = [g for g, p in walk_list for g in getattr(g, 'geoms', [g]) if g.geom_type == 'LineString']
    stats.update({
        'sidewalks_drawn_km': round(sum(g.length for g, p in walk_list if p['kind'] == 'sidewalk' and p['drawn']) / 1000, 1),
        'sidewalks_made_km': round(sum(g.length for g, p in walk_list if p['kind'] == 'sidewalk' and not p['drawn']) / 1000, 1),
        'crossings_drawn': kinds[('crossing', True)], 'crossings_made': kinds[('crossing', False)],
        'paths_km': round(sum(g.length for g, p in walk_list if p['kind'] not in ('sidewalk', 'crossing')) / 1000, 1),
        'lots': sum(1 for _, p in area_list if p['kind'] == 'lot'), 'stalls': len(stalls),
        'parks': sum(1 for _, p in area_list if p['kind'] == 'park'), 'plazas': sum(1 for _, p in area_list if p['kind'] == 'plaza'),
        'landuse_areas': sum(1 for _, p in area_list if p['kind'] == 'landuse'),
        'walk_network_largest_share': connected(walk_lines, 2.0),
        'beaches': sum(1 for _, p in area_list if p['kind'] == 'beach'),
        'use_samples': {k: int((use == v).sum()) for k, v in USE.items()},
    })
    (m.base / 'streets.json').write_text(json.dumps(stats, indent=1) + '\n')
    print('streets:', json.dumps(stats), flush=True)
    return area_list
