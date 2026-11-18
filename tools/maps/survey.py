"""Survey the ground round a city for its best cut: which rectangle, up to 255 chunks a side, makes the best map.
python tools/maps/survey.py <map folder> [--window 40960] [--top 3]

Reads the city's centre and sources from city.json and works in its own projection (frame.py: a Transverse Mercator
round `centre`), so a cut it proposes is `bounds` in metres from that centre, ready for city.json. It fetches a light
view of a window round the centre into var/survey/<name>/ (ignored by git; every kept file in its downloads.json, as
fetch.py keeps a map's), one request at a time as the free services ask:

  buildings  FEMA / ORNL USA Structures: each structure's point, height, floor area and median occupants, no outlines
  cover      USGS / MRLC NLCD 2021 land cover at 30 m
  ground     USGS 3DEP elevation at 30 m (the 3DEP image service: any place in the US, not one lidar project)
  places     OpenStreetMap features with a Wikidata link and a kind worth travelling for: a proxy for what people know

and scores cells of 256 m (four chunks), then every rectangle of whole cells by summed areas. A cell is worth its
built fabric, its landmarks, its relief, its coast and a little wild ground; open sea far from land costs, since a map
pays for every square of it and a player has nothing there (WEIGHTS, below, says by how much). Writes cuts.json (the
best few that do not overlap much, each with what it holds) and survey.png (the window, the cuts, and the city's
present frames). The rectangle it finds is a start: snap it round what the picture shows before a build."""
import argparse
import json
import math
import sys
from pathlib import Path
import numpy as np
import requests
from PIL import Image, ImageDraw, ImageFont
from pyproj import Transformer

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE.parent / 'mapdata'))
from common import Manifest, Map, get  # noqa: E402


def settings(city):
    """A v2 city.json over tools/maps/sources.json, as city.ts lays them: the sources this reads are shared ones."""
    shared = json.loads((HERE / 'sources.json').read_text())
    out = {k: v for k, v in shared.items() if not k.startswith('_')}
    for k, v in city.items():
        out[k] = {**out[k], **v} if isinstance(v, dict) and isinstance(out.get(k), dict) else v
    return out

CHUNK = 64
CELL = 256
# The most chunks a side: the page refuses a ground wider than the device's largest texture, 2,048 pixels on many
# phones, which holds 255 chunks (planning/reference/maps.md).
MAX_CHUNKS = 255
# A cut's sides are whole cells here; the last cell is trimmed to MAX_CHUNKS when the cut is written out.
MAX_CELLS = math.ceil(MAX_CHUNKS * CHUNK / CELL)
MIN_CELLS = 32

# What a cell is worth. Each term is first put on 0 to 1 within the window (urban by its 99th percentile), so the
# weights compare like with like across cities. Tuned by eye on the five cities' pictures, 2026-11-18.
WEIGHTS = {
    'urban': 1.0,      # built floor area, by its square root: towers count for more than houses, not for all
    'tall': 0.5,       # structures of 40 m and more: a skyline reads from far off and gives the game its heights
    'landmarks': 0.8,  # OSM features with a Wikidata link, a tourist or historic one counting twice
    'relief': 0.4,     # the ground's range in the cell, full at 60 m: hills, cliffs and valleys
    'coast': 0.6,      # land meeting water in the cell: beaches, harbours, bridges, boats
    'nearshore': 0.5,  # water within 1.5 km of land: the harbours' and the found boats' room (at 0.7 Tampa went half water)
    'wild': 0.25,      # forest, wetland and scrub: where a survivor gathers
    'dead_sea': -0.5,  # water 1.5 km and more from any land: nothing for a player, every byte paid for
}
LANDMARK_KINDS = [
    ('tourism', None, 2), ('historic', None, 2), ('leisure', 'stadium|marina|nature_reserve|park', 1),
    ('man_made', 'tower|lighthouse|pier|observatory|water_tower', 2), ('bridge', None, 2), ('aeroway', 'aerodrome', 1),
    ('amenity', 'university|theatre|arts_centre|museum|place_of_worship|casino', 1), ('building', None, 1),
    ('natural', 'peak|beach|bay|cliff|cape', 2),
]
FEMA_FIELDS = 'LONGITUDE,LATITUDE,HEIGHT,SQMETERS,POP_MEDIAN'
ELEVATION = 'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage'


class Survey:
    def __init__(self, folder, window):
        self.m = Map(folder)
        self.m.city = c = settings(self.m.city)
        self.name = c['name']
        lon, lat = c['centre']
        self.proj = f'+proj=tmerc +lat_0={lat} +lon_0={lon} +k=1 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs +type=crs'
        self.to_lonlat = Transformer.from_crs(self.proj, 4326, always_xy=True)
        self.from_lonlat = Transformer.from_crs(4326, self.proj, always_xy=True)
        self.half = window // 2 // CELL * CELL
        self.n = 2 * self.half // CELL
        self.out = ROOT / 'var' / 'survey' / self.name
        # Manifest keeps its records beside the downloads, not in the map's own downloads.json.
        self.m.raw = self.out / 'raw'
        self.man = Manifest(self.m)
        self.man.path = self.out / 'downloads.json'
        self.man.records = json.loads(self.man.path.read_text()) if self.man.path.exists() else {}

    def lonlat_box(self, margin=0.0):
        h = self.half
        xs, ys = np.array([-h, h, h, -h]), np.array([-h, -h, h, h])
        lon, lat = self.to_lonlat.transform(xs, ys)
        return lon.min() - margin, lat.min() - margin, lon.max() + margin, lat.max() + margin

    def keep(self, name, url, source, licence, params=None, data=None, accept=None):
        path = self.m.raw / name
        if not path.exists():
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(get(url, params=params, data=data, accept=accept).content)
            full = url if data is not None else requests.Request('GET', url, params=params).prepare().url
            self.man.record(name, full, source, licence, path.read_bytes(), 'POST' if data is not None else 'GET', data)
        return path

    # The cell a point in metres falls in, as row (north to south) and column (west to east); -1 outside the window.
    def cells(self, x, y):
        col = np.floor((x + self.half) / CELL).astype(int)
        row = np.floor((self.half - y) / CELL).astype(int)
        inside = (col >= 0) & (col < self.n) & (row >= 0) & (row < self.n)
        return np.where(inside, row, -1), np.where(inside, col, -1)

    def buildings(self):
        f = self.m.city['footprints']
        w, s, e, n = self.lonlat_box()
        query = {'f': 'json', 'where': '1=1', 'geometry': f'{w},{s},{e},{n}', 'geometryType': 'esriGeometryEnvelope',
                 'inSR': 4326, 'spatialRel': 'esriSpatialRelIntersects'}
        total = json.loads(self.keep('fema/count.json', f['service'] + '/query', f['source'], f['licence'],
                                     params={**query, 'returnCountOnly': 'true'}).read_text())['count']
        # By tiles of about 5 km, each paged by the last id seen. Paging the whole window by offset made the service
        # count past every row before each page (Los Angeles's 1.1 million: a minute a page by its fortieth); by id
        # over the whole window, 7 s a page; by id over a 5 km tile, 0.4 s (2026-11-18). A structure on a tile's
        # edge is in both tiles' answers and is kept once.
        seen, rows, pages, tiles = set(), [], 0, 8
        step = 2 * self.half / tiles
        for ty in range(tiles):
            for tx in range(tiles):
                x0, y0 = -self.half + tx * step, -self.half + ty * step
                lon, lat = self.to_lonlat.transform([x0, x0 + step, x0 + step, x0], [y0, y0, y0 + step, y0 + step])
                box = {**query, 'geometry': f'{min(lon)},{min(lat)},{max(lon)},{max(lat)}'}
                last, page = 0, 0
                while True:
                    p = self.keep(f'fema-tiles/{ty}_{tx}_{page:03}.json', f['service'] + '/query', f['source'], f['licence'], params={
                        **box, 'where': f'OBJECTID > {last}', 'outFields': 'OBJECTID,' + FEMA_FIELDS, 'returnGeometry': 'false',
                        'orderByFields': 'OBJECTID', 'resultRecordCount': 2000})
                    feats = [ft['attributes'] for ft in json.loads(p.read_text()).get('features', [])]
                    for a in feats:
                        if a['OBJECTID'] not in seen:
                            seen.add(a['OBJECTID'])
                            rows.append([a['LONGITUDE'] or 0, a['LATITUDE'] or 0, a['HEIGHT'] or 0, a['SQMETERS'] or 0, a['POP_MEDIAN'] or 0])
                    pages += 1
                    if len(feats) < 2000:
                        break
                    last, page = max(a['OBJECTID'] for a in feats), page + 1
            print(f'  buildings {len(rows):,} of {total:,} after {pages} pages', flush=True)
        a = np.array(rows, float).reshape(-1, 5)
        x, y = self.from_lonlat.transform(a[:, 0], a[:, 1])
        r, c = self.cells(x, y)
        ok = r >= 0
        grids = {k: np.zeros((self.n, self.n)) for k in ('count', 'floor', 'tall', 'people')}
        np.add.at(grids['count'], (r[ok], c[ok]), 1)
        # Floor area: footprint times storeys, a storey taken as 3.5 m and every structure at least one.
        np.add.at(grids['floor'], (r[ok], c[ok]), a[ok, 3] * np.maximum(1, np.round(a[ok, 2] / 3.5)))
        np.add.at(grids['tall'], (r[ok], c[ok]), a[ok, 2] >= 40)
        np.add.at(grids['people'], (r[ok], c[ok]), a[ok, 4])
        print(f'buildings: {int(ok.sum()):,} in the window', flush=True)
        return grids

    def raster_cells(self, path, reduce):
        """Each pixel of a GeoTIFF put in its cell by its centre; `reduce` turns a cell's values into its numbers."""
        import rasterio
        with rasterio.open(path) as src:
            data = src.read(1)
            rows, cols = np.indices(data.shape)
            px, py = src.transform * (cols.ravel() + 0.5, rows.ravel() + 0.5)
            to = Transformer.from_crs(src.crs, self.proj, always_xy=True)
            x, y = to.transform(px, py)
        r, c = self.cells(np.asarray(x), np.asarray(y))
        return reduce(data.ravel(), r, c)

    def cover(self):
        c = self.m.city['nlcd']
        b = Transformer.from_crs(4326, 3857, always_xy=True).transform_bounds(*self.lonlat_box(0.01), densify_pts=21)
        path = self.keep('nlcd.tif', c['url'], c['source'], c['licence'], params={
            'service': 'WCS', 'version': '1.0.0', 'request': 'GetCoverage', 'coverage': c['coverage'], 'crs': 'EPSG:3857',
            'bbox': ','.join(map(str, b)), 'resx': 30, 'resy': 30, 'format': 'GeoTIFF'}, accept=lambda d: d[:2] in (b'II', b'MM'))
        # 0 is past NLCD's edge, which along a coast is the open sea (on Miami's window, 655,541 pixels of the Atlantic
        # counted as land until it was water); 255 is its no-data.
        groups = {'water': [11, 0, 255], 'developed': [22, 23, 24], 'open_developed': [21], 'wild': [41, 42, 43, 52, 90, 95],
                  'grass': [71, 81, 82], 'barren': [31]}

        def reduce(v, r, c):
            ok = r >= 0
            total = np.zeros((self.n, self.n))
            np.add.at(total, (r[ok], c[ok]), 1)
            out = {}
            for k, codes in groups.items():
                g = np.zeros((self.n, self.n))
                np.add.at(g, (r[ok], c[ok]), np.isin(v[ok], codes))
                out[k] = g / np.maximum(total, 1)
            return out
        print('cover done', flush=True)
        return self.raster_cells(path, reduce)

    def ground(self):
        b = Transformer.from_crs(4326, 3857, always_xy=True).transform_bounds(*self.lonlat_box(0.01), densify_pts=21)
        size = int((b[2] - b[0]) / 30)
        path = self.keep('elevation.tif', ELEVATION, 'USGS 3D Elevation Program, through its image service',
                         'Public domain (USGS)', params={
                             'bbox': ','.join(map(str, b)), 'bboxSR': 3857, 'imageSR': 3857, 'size': f'{size},{size}',
                             'format': 'tiff', 'pixelType': 'F32', 'noDataInterpretation': 'esriNoDataMatchAny',
                             'interpolation': 'RSP_BilinearInterpolation', 'f': 'image'}, accept=lambda d: d[:2] in (b'II', b'MM'))

        def reduce(v, r, c):
            ok = (r >= 0) & (v > -500) & (v < 9000)
            lo, hi = np.full((self.n, self.n), np.inf), np.full((self.n, self.n), -np.inf)
            np.minimum.at(lo, (r[ok], c[ok]), v[ok])
            np.maximum.at(hi, (r[ok], c[ok]), v[ok])
            return {'low': np.where(np.isfinite(lo), lo, 0), 'high': np.where(np.isfinite(hi), hi, 0)}
        print('ground done', flush=True)
        return self.raster_cells(path, reduce)

    def places(self):
        o = self.m.city['osm']
        w, s, e, n = self.lonlat_box()
        bbox = f'{s:.4f},{w:.4f},{n:.4f},{e:.4f}'
        parts = ''.join(f'nwr["wikidata"]["{k}"{f"~\"^({v})$\"" if v else ""}]({bbox});' for k, v, _ in LANDMARK_KINDS)
        query = f'[out:json][timeout:300];({parts});out center tags;'
        path = None
        for server in o['servers']:
            try:
                path = self.keep('osm_places.json', server, o['source'], o['licence'], data={'data': query},
                                 accept=lambda d: d.lstrip()[:1] == b'{' and b'"remark"' not in d[-400:])
                break
            except Exception as ex:
                print(f'  {server} gave up: {str(ex)[:160]}', flush=True)
        if path is None:
            raise RuntimeError('no Overpass server answered')
        found = []
        for el in json.loads(path.read_text())['elements']:
            p = el.get('center') or el
            if 'lon' not in p:
                continue
            t = el.get('tags', {})
            weight = max((wt for k, v, wt in LANDMARK_KINDS if k in t and (v is None or t[k] in v.split('|'))), default=1)
            found.append((p['lon'], p['lat'], weight, t.get('name') or t.get('name:en') or '', 'wikipedia' in t))
        x, y = self.from_lonlat.transform([f[0] for f in found], [f[1] for f in found])
        r, c = self.cells(np.array(x), np.array(y))
        grid = np.zeros((self.n, self.n))
        named = []
        for i, f in enumerate(found):
            if r[i] >= 0:
                grid[r[i], c[i]] += f[2]
                if f[3] and f[4]:
                    named.append((f[3], float(x[i]), float(y[i]), f[2]))
        print(f'places: {len(found):,} with a Wikidata link, {len(named):,} named with a Wikipedia page', flush=True)
        return grid, named


def coast_and_dead(water):
    """Cells where land meets water, water within 1.5 km of land, and water cells 1.5 km or more from any land."""
    from scipy.ndimage import distance_transform_edt
    land = water < 0.9
    coast = np.clip(np.minimum(water, 1 - water) * 2, 0, 1)
    far = distance_transform_edt(~land) * CELL >= 1500
    return coast, ~land & ~far, far & (water >= 0.95)


# A cut keeps the city's core this many cells (about 4 km) from each edge, so the city can be come at from every side:
# by weights alone Tampa's best cut held downtown 1.5 km from its edge and left out the bay front.
CORE_INSET = 16


def core_of(g):
    """The cell where tall structures and floor area crowd most, smoothed over about a kilometre."""
    from scipy.ndimage import uniform_filter
    return np.unravel_index(np.argmax(uniform_filter(g['tall'] * 4 + np.sqrt(g['floor']) / 300, 5)), g['tall'].shape)


def score(g):
    def unit(a, q=99):
        top = np.percentile(a, q)
        return np.clip(a / top, 0, 1) if top > 0 else np.zeros_like(a)
    coast, near, dead = coast_and_dead(g['water'])
    # Floor area by its square root: by its logarithm a cell of houses scored nearly as a cell of towers, and on
    # Tampa the best cut was 16 km of suburbs with one tall building over downtown's 26 (2026-11-18). Landmarks by the
    # root of their weighted count, not a percentile: a window holds only a hundred or so cells with one.
    terms = {
        'urban': unit(np.sqrt(g['floor']), 99.5),
        'tall': unit(g['tall'], 99.5),
        'landmarks': np.clip(np.sqrt(g['landmarks']) / 2, 0, 2),
        'relief': np.clip((g['high'] - g['low']) / 60, 0, 1),
        'coast': coast,
        'nearshore': near.astype(float),
        'wild': np.clip(g['wild'], 0, 1),
        'dead_sea': dead.astype(float),
    }
    return sum(WEIGHTS[k] * v for k, v in terms.items()), terms


def best_cuts(cell, top, core=None, inset=0):
    """The best rectangles of whole cells, sides MIN_CELLS to MAX_CELLS, that overlap no better one by half or more;
    with `core`, only those holding that cell `inset` cells or more from every edge."""
    n = cell.shape[0]
    sat = np.zeros((n + 1, n + 1))
    sat[1:, 1:] = cell.cumsum(0).cumsum(1)
    found = []
    for h in range(MIN_CELLS, MAX_CELLS + 1):
        for w in range(MIN_CELLS, MAX_CELLS + 1):
            s = sat[h:, w:] - sat[:-h, w:] - sat[h:, :-w] + sat[:-h, :-w]
            if core is not None:
                R, C = np.indices(s.shape)
                s = np.where((core[0] - R >= inset) & (R + h - 1 - core[0] >= inset) &
                             (core[1] - C >= inset) & (C + w - 1 - core[1] >= inset), s, -np.inf)
                if not np.isfinite(s).any():
                    continue
            r, c = np.unravel_index(np.argmax(s), s.shape)
            found.append((float(s[r, c]), int(r), int(c), h, w))
            # The runners-up at this size, for alternatives in other places.
            for _ in range(3):
                s[max(0, r - h // 2):r + h // 2 + 1, max(0, c - w // 2):c + w // 2 + 1] = -np.inf
                r, c = np.unravel_index(np.argmax(s), s.shape)
                if np.isfinite(s[r, c]):
                    found.append((float(s[r, c]), int(r), int(c), h, w))
    found.sort(reverse=True)
    picked = []
    for f in found:
        _, r, c, h, w = f
        if all(overlap((r, c, h, w), p[1:]) < 0.5 for p in picked):
            picked.append(f)
        if len(picked) == top:
            break
    return picked


def overlap(a, b):
    ra, ca, ha, wa = a
    rb, cb, hb, wb = b
    dy = max(0, min(ra + ha, rb + hb) - max(ra, rb))
    dx = max(0, min(ca + wa, cb + wb) - max(ca, cb))
    return dy * dx / min(ha * wa, hb * wb)


def on_lattice(v):
    """The nearest chunk edge: the centre falls mid-chunk (a 127-chunk square is ±4,064 m), so edges are 32 m off 64."""
    return 64 * round((v - 32) / 64) + 32


def to_bounds(s, r, c, h, w):
    """A cut of whole cells as bounds in metres from the centre, on chunk edges, each side trimmed to MAX_CHUNKS."""
    west, north = on_lattice(-s.half + c * CELL), on_lattice(s.half - r * CELL)
    width, depth = min(w * CELL, MAX_CHUNKS * CHUNK), min(h * CELL, MAX_CHUNKS * CHUNK)
    return [west, north - depth, west + width, north]


def to_frame(bounds):
    """The lattice column and row of a cut's south-east corner (frame.py's `frame`): today's squares put theirs, at
    east 4,064 and south -4,064, on the lattice's middle, 2048 and 2048; a column is a chunk further east, a row one
    further south (miami-coast: east 6,112 and south -6,112 are 2016 and 2016)."""
    east, south = bounds[2], bounds[1]
    return [2048 - (east - 4064) // CHUNK, 2048 + (south + 4064) // CHUNK]


def describe(s, g, terms, named, bounds):
    west, south, east, north = bounds
    # Snapped to chunk edges, a cut can reach a few metres past the window: its cells are the window's it covers.
    within = lambda v: int(min(max(v, 0), s.n))  # noqa: E731
    c0, c1 = within((west + s.half) // CELL), within((east + s.half + CELL - 1) // CELL)
    r0, r1 = within((s.half - north) // CELL), within((s.half - south + CELL - 1) // CELL)
    sl = (slice(r0, r1), slice(c0, c1))
    inside = sorted((p for p in named if west <= p[1] < east and south <= p[2] < north), key=lambda p: -p[3])
    inside = [p for i, p in enumerate(inside) if p[0] not in {q[0] for q in inside[:i]}]
    corners = {k: [round(v, 5) for v in s.to_lonlat.transform(x, y)] for k, (x, y) in
               {'NW': (west, north), 'NE': (east, north), 'SE': (east, south), 'SW': (west, south)}.items()}
    return {
        'bounds': bounds, 'frame': to_frame(bounds), 'size_km': [round((east - west) / 1000, 2), round((north - south) / 1000, 2)],
        'chunks': [(east - west) // CHUNK, (north - south) // CHUNK], 'corners_lon_lat': corners,
        'land_km2': round(float(((1 - g['water'][sl]) * (CELL / 1000) ** 2).sum()), 1),
        'water_share': round(float(g['water'][sl].mean()), 3),
        'dead_sea_share': round(float(terms['dead_sea'][sl].mean()), 3),
        'structures': int(g['count'][sl].sum()), 'tall_structures': int(g['tall'][sl].sum()),
        'floor_km2': round(float(g['floor'][sl].sum() / 1e6), 1), 'people': int(g['people'][sl].sum()),
        'relief_m': round(float(g['high'][sl].max() - g['low'][sl][g['low'][sl] != 0].min()), 1) if (g['low'][sl] != 0).any() else 0,
        'landmarks': int(g['landmarks'][sl].sum()),
        'known_places': [p[0] for p in inside[:40]],
    }


def picture(s, g, cuts, path):
    """The window from above: water blue, built ground grey by its floor area, wild ground green, relief as light."""
    n = s.n
    water, urban, wild = g['water'], np.clip(np.log1p(g['floor']) / max(np.log1p(g['floor']).max(), 1), 0, 1), g['wild']
    relief = np.clip((g['high'] - g['low']) / 60, 0, 1)
    rgb = np.stack([
        235 - 120 * water - 100 * urban - 60 * wild + 20 * relief,
        228 - 70 * water - 100 * urban - 10 * wild + 20 * relief,
        210 + 30 * water - 100 * urban - 90 * wild + 20 * relief], -1)
    scale = 6
    img = Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8)).resize((n * scale, n * scale), Image.NEAREST)
    d = ImageDraw.Draw(img)
    font = ImageFont.load_default()

    def box(b, colour, width, label=None):
        x0, x1 = (b[0] + s.half) / CELL * scale, (b[2] + s.half) / CELL * scale
        y0, y1 = (s.half - b[3]) / CELL * scale, (s.half - b[1]) / CELL * scale
        d.rectangle([x0, y0, x1, y1], outline=colour, width=width)
        if label:
            d.text((x0 + 6, y0 + 4), label, fill=colour, font=font)

    for frame, colour in present_frames(s):
        box(frame, colour, 2, 'today')
    for i, cut in enumerate(cuts):
        box(cut['bounds'], (220, 30, 30) if i == 0 else (240, 140, 0), 4 if i == 0 else 2, f'#{i + 1}')
    img.save(path)


def present_frames(s):
    """Today's frames of this city and of any map in the same projection (a widened one), in this window's metres."""
    out = []
    maps = ROOT / 'assets' / 'source' / 'maps'
    for folder in sorted(maps.iterdir()):
        mj = folder / 'map.json'
        if mj.exists():
            cfg = json.loads(mj.read_text())
            if cfg.get('center_lon_lat') and np.allclose(cfg['center_lon_lat'], s.m.city['centre']):
                out.append((cfg['bounds'], (255, 255, 255)))
            elif cfg.get('center_lon_lat'):
                # Another projection: its corners into this one.
                xs, ys = s.from_lonlat.transform(*zip(*cfg['corners_lon_lat'].values()))
                if -s.half < np.mean(xs) < s.half and -s.half < np.mean(ys) < s.half:
                    out.append(([min(xs), min(ys), max(xs), max(ys)], (200, 200, 255)))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('folder')
    ap.add_argument('--window', type=int, default=40960)
    ap.add_argument('--top', type=int, default=3)
    a = ap.parse_args()
    s = Survey(a.folder, a.window)
    s.out.mkdir(parents=True, exist_ok=True)
    g = {**s.buildings(), **s.cover(), **s.ground()}
    g['landmarks'], named = s.places()
    np.savez_compressed(s.out / 'cells.npz', **g)
    cell, terms = score(g)
    core = core_of(g)
    # The first cut keeps the core inside; the others are the best anywhere, for comparison.
    held = best_cuts(cell, 1, core, CORE_INSET)
    rest = [f for f in best_cuts(cell, a.top + 1) if all(overlap(f[1:], h[1:]) < 0.5 for h in held)]
    cuts = [describe(s, g, terms, named, to_bounds(s, *f[1:])) | {'score': round(f[0], 1)} for f in (held + rest)[:a.top]]
    (s.out / 'cuts.json').write_text(json.dumps({'city': s.name, 'centre': s.m.city['centre'], 'cell_m': CELL,
                                                'window_m': 2 * s.half, 'weights': WEIGHTS, 'cuts': cuts}, indent=1) + '\n')
    picture(s, g, cuts, s.out / 'survey.png')
    for i, c in enumerate(cuts):
        print(f"#{i + 1} {c['size_km'][0]} x {c['size_km'][1]} km bounds={c['bounds']} land={c['land_km2']} km2 "
              f"structures={c['structures']:,} tall={c['tall_structures']} landmarks={c['landmarks']} score={c['score']}")
        print('   ', ', '.join(c['known_places'][:15]))


if __name__ == '__main__':
    main()
