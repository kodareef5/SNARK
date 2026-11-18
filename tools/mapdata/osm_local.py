"""OpenStreetMap from a regional extract (Geofabrik's daily state files), answered as the Overpass queries beside this
file answer: the same elements, the same JSON. Every stage reads raw/osm/*.json as Overpass wrote it, so which way the
data came is the fetch's business alone.

Why: the public Overpass servers were at capacity for most of 2026-11-18. Miami's whole fetch took 16 minutes, mostly
waiting; one 8 km square's streets had no answer in 25 minutes; by 4 km tiles, three minutes a tile, so about fifty
minutes a 16 km city for streets alone. An extract is fetched once a region for every city in it, and cutting a city
from it here takes no one's queue.

The selections below are the .overpassql files', line for line: keep them in step. Overpass's `~` is a search, not a
whole match, unless its pattern is anchored. A way in the area comes whole (osmium extract's smart strategy, as
Overpass gives a way's every node), and so does a multipolygon relation's every member."""
import re
import subprocess
from pathlib import Path
import osmium


def has(k):
    return lambda t: k in t


def eq(k, v):
    return lambda t: t.get(k) == v


def match(k, rx):
    r = re.compile(rx)
    return lambda t: k in t and r.search(t[k]) is not None


def both(*ps):
    return lambda t: all(p(t) for p in ps)


# Each query: how it is put out, and its lines as (element types: n, w, r) and a test of the tags.
QUERIES = {
    'all': ('center', [('wr', has('building')), ('nwr', has('amenity')), ('nwr', has('leisure')), ('nwr', has('tourism')),
                       ('nwr', has('historic')), ('nwr', has('shop')), ('nwr', has('office')), ('nwr', has('man_made')),
                       ('nwr', eq('natural', 'beach')), ('nwr', eq('railway', 'station')), ('nwr', eq('public_transport', 'station')),
                       ('w', both(has('bridge'), has('name'))), ('nwr', match('place', 'island|islet|neighbourhood|suburb|quarter'))]),
    'ways': ('geom', [('w', both(has('bridge'), has('highway'))), ('w', both(has('bridge'), has('railway'))),
                      ('w', eq('man_made', 'bridge')), ('w', eq('man_made', 'pier')), ('w', eq('man_made', 'breakwater')),
                      ('w', eq('man_made', 'groyne')), ('w', both(eq('man_made', 'tower'), eq('tower:type', 'bridge'))),
                      ('w', eq('highway', 'steps')), ('w', both(match('inscription', '^[A-Z ]{1,24}$'), has('height')))]),
    'features': ('geom', [('wr', has('building:part')), ('wr', eq('natural', 'water')), ('w', has('water')),
                          ('w', eq('leisure', 'swimming_pool')), ('w', eq('amenity', 'fountain')),
                          ('w', match('aeroway', '^(runway|taxiway|apron|helipad)$')), ('w', eq('attraction', 'big_wheel'))]),
    'buildings': ('body', [('wr', has('building'))]),
    'streets': ('body', [('w', has('highway')), ('n', match('highway', '^(crossing|traffic_signals|stop|give_way)$')),
                         ('n', has('entrance')), ('wr', eq('amenity', 'parking')), ('wr', has('landuse')),
                         ('w', match('leisure', '^(park|garden|playground|pitch|dog_park|common|recreation_ground)$')),
                         ('r', match('leisure', '^(park|garden|recreation_ground)$')), ('w', eq('place', 'square')),
                         ('w', has('area:highway')), ('wr', eq('natural', 'beach'))]),
}


def cut(region, bounds, out):
    """The area round a city (west, south, east and north in degrees), every way in it whole, from a region's file."""
    w, s, e, n = bounds
    subprocess.run(['osmium', 'extract', '--strategy', 'smart', '--set-bounds', '--overwrite', '-b', f'{w},{s},{e},{n}',
                    '-o', str(out), str(region)], check=True)


def wants(kind, tags, names):
    """The queries among `names` whose lines take an element of this kind (n, w or r) with these tags."""
    return [q for q in names if any(kind in types and test(tags) for types, test in QUERIES[q][1])]


class Relations(osmium.SimpleHandler):
    """First pass: the relations each query takes, and every way a taken relation has as a member."""

    def __init__(self, names):
        super().__init__()
        self.names, self.taken, self.member_ways = names, {}, set()

    def relation(self, r):
        tags = {t.k: t.v for t in r.tags}
        qs = wants('r', tags, self.names)
        if qs:
            members = [(m.type, m.ref, m.role) for m in r.members]
            self.taken[r.id] = (tags, members, qs)
            self.member_ways.update(ref for t, ref, _ in members if t == 'w')


class Elements(osmium.SimpleHandler):
    """Second pass, with each node's place: the nodes and ways each query takes, and the ways the relations need."""

    def __init__(self, names, member_ways):
        super().__init__()
        self.names, self.member_ways = names, member_ways
        self.out = {q: [] for q in names}
        self.shapes, self.points = {}, {}

    def node(self, n):
        if not n.tags:
            return
        tags = {t.k: t.v for t in n.tags}
        for q in wants('n', tags, self.names):
            self.out[q].append({'type': 'node', 'id': n.id, 'lat': n.location.lat, 'lon': n.location.lon, 'tags': tags})

    def way(self, w):
        tags = {t.k: t.v for t in w.tags}
        qs = wants('w', tags, self.names)
        if not qs and w.id not in self.member_ways:
            return
        try:
            geometry = [{'lat': nd.location.lat, 'lon': nd.location.lon} for nd in w.nodes]
        except osmium.InvalidLocationError:
            geometry = [{'lat': nd.location.lat, 'lon': nd.location.lon} for nd in w.nodes if nd.location.valid()]
        if w.id in self.member_ways:
            self.shapes[w.id] = geometry
        for q in qs:
            self.out[q].append(shape_out(QUERIES[q][0], 'way', w.id, tags, geometry, [nd.ref for nd in w.nodes]))


def center(geometry):
    lats, lons = [p['lat'] for p in geometry], [p['lon'] for p in geometry]
    return {'lat': (min(lats) + max(lats)) / 2, 'lon': (min(lons) + max(lons)) / 2} if lats else None


def shape_out(form, kind, eid, tags, geometry, nodes=None, members=None):
    """An element as Overpass puts it out: `out tags center`, `out tags geom` or `out body geom`."""
    el = {'type': kind, 'id': eid, 'tags': tags}
    if form == 'center':
        c = center(geometry)
        if c:
            el['center'] = c
        return el
    if kind == 'way':
        el['geometry'] = geometry
        if form == 'body':
            el['nodes'] = nodes
    else:
        el['members'] = members
    return el


def answer(pbf, names):
    """Every query of `names` answered from a cut's file: {name: Overpass's JSON}."""
    rels = Relations(names)
    rels.apply_file(str(pbf))
    els = Elements(names, rels.member_ways)
    els.apply_file(str(pbf), locations=True, idx='flex_mem')
    for rid, (tags, members, qs) in rels.taken.items():
        outs = [{'type': {'w': 'way', 'n': 'node', 'r': 'relation'}[t], 'ref': ref, 'role': role,
                 **({'geometry': els.shapes.get(ref, [])} if t == 'w' else {})} for t, ref, role in members]
        whole = [p for m in outs for p in m.get('geometry', [])]
        for q in qs:
            form = QUERIES[q][0]
            el = {'type': 'relation', 'id': rid, 'tags': tags}
            if form == 'center':
                c = center(whole)
                if c:
                    el['center'] = c
            else:
                el['members'] = outs
            els.out[q].append(el)
    return {q: {'elements': v} for q, v in els.out.items()}


def region_file(cache, region):
    """The region's extract in the shared cache (var/osm-extracts), fetched once for every city in it."""
    path = Path(cache) / f'{Path(region).name}-latest.osm.pbf'
    if not path.exists():
        url = f'https://download.geofabrik.de/{region}-latest.osm.pbf'
        path.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(['curl', '-sSL', '--retry', '5', '-o', str(path) + '.part', url], check=True)
        subprocess.run(['curl', '-sSL', '-o', str(path) + '.md5', url + '.md5'], check=True)
        Path(str(path) + '.part').rename(path)
        want = Path(str(path) + '.md5').read_text().split()[0]
        got = subprocess.run(['md5sum', str(path)], capture_output=True, text=True, check=True).stdout.split()[0]
        if want != got:
            path.rename(str(path) + '.bad')
            raise RuntimeError(f'{path.name}: md5 {got}, the extract says {want}')
    return path
