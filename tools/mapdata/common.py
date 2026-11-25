"""A map's folder and its settings: map.json (the frame, written by frame.py) and city.json (what to fetch and the rules)."""
from pathlib import Path
import datetime as dt
import hashlib
import json
import sys
import time
import numpy as np
from affine import Affine
from PIL import Image

# The layers a stage reads are pictures an earlier stage wrote, about a metre a pixel: a 16 km cut's fine layers are
# 16,320 pixels a side, 270 million, past Pillow's guard against a picture that unpacks to more than it says, which is
# for pictures from elsewhere. The downloads are read by rasterio and the guard stays on their side.
Image.MAX_IMAGE_PIXELS = None

CLIENT = 'mapdata/1.0'
# The lattice's middle (shared/coords.ts), and the corner the map build's north-west noise is read from: the north-west
# corner of a map 127 chunks a side there, in metres west and north of the middle's corner.
FRAME_MIDDLE = 2048
NOISE_CORNER = 127 * 64


class Map:
    def __init__(self, folder):
        self.root = Path(folder).resolve()
        self.city = json.loads((self.root / 'city.json').read_text())
        self.raw = self.root / 'raw'
        self.base = self.root / 'base'
        path = self.root / 'map.json'
        self.cfg = json.loads(path.read_text()) if path.exists() else None
        if self.cfg:
            self.crs = self.cfg['crs_wkt']
            self.b = self.cfg['bounds']
            self.width, self.depth = self.b[2] - self.b[0], self.b[3] - self.b[1]
            # The 2 m samples as a picture holds them: rows north to south, then columns west to east.
            self.shape = (self.cfg['grid_samples'][1], self.cfg['grid_samples'][0])
            self.grid = Affine(self.cfg['spacing_m'], 0, self.b[0] - 1, 0, -self.cfg['spacing_m'], self.b[3] + 1)
            # Columns and rows from the corner the build's north-west noise is read from to the frame's (base.ts, Grid).
            col, row = self.cfg['frame']
            self.noise = ((NOISE_CORNER - self.width - (col - FRAME_MIDDLE) * 64) / 2, (NOISE_CORNER - self.depth - (row - FRAME_MIDDLE) * 64) / 2)

    def transform(self, shape):
        rows, cols = shape
        return Affine(self.width / cols, 0, self.b[0], 0, -self.depth / rows, self.b[3])

    def fine_shape(self):
        """Pixel areas of the fine layers, rows and columns: a metre each, edges on whole projection metres, so every cut
        of a city puts its pixels in the same places."""
        return round(self.depth), round(self.width)

    def lonlat_bounds(self, margin=0.0):
        c = self.cfg['corners_lon_lat']
        lons = [p[0] for p in c.values()]
        lats = [p[1] for p in c.values()]
        return min(lons) - margin, min(lats) - margin, max(lons) + margin, max(lats) + margin

    def vectors(self, name):
        from shapely.geometry import shape
        data = json.loads((self.base / f'{name}.geojson').read_text())
        return [(shape(f['geometry']), f['properties']) for f in data['features']]

    def burn(self, items, shape, tx=None):
        from rasterio.features import rasterize
        items = list(items)
        if not items:
            return np.zeros(shape, np.uint8)
        return rasterize(items, out_shape=shape, transform=tx or self.transform(shape), fill=0, dtype='uint8')

    def write_features(self, name, features, folder=None):
        from shapely.geometry import mapping
        (folder or self.base).mkdir(parents=True, exist_ok=True)
        ((folder or self.base) / f'{name}.geojson').write_text(json.dumps({
            'type': 'FeatureCollection', 'name': name,
            'crs': {'type': 'name', 'properties': {'name': self.cfg['crs_proj']}},
            'features': [{'type': 'Feature', 'geometry': mapping(g), 'properties': p} for g, p in features]}, separators=(',', ':')))


def relation_polygon(members, to_map):
    """A multipolygon relation's area from its members' shapes (out geom): outer rings, which may be drawn in several
    ways, joined and less the inner ones. None when the members close no ring."""
    from shapely import make_valid
    from shapely.geometry import LineString
    from shapely.ops import polygonize, unary_union
    rings = {'outer': [], 'inner': []}
    for mb in members:
        g = mb.get('geometry') or []
        if mb.get('type') == 'way' and len(g) >= 2 and mb.get('role') in rings:
            rings[mb['role']].append(LineString([to_map(p['lon'], p['lat']) for p in g]))
    outer = [make_valid(p) for p in polygonize(unary_union(rings['outer']))] if rings['outer'] else []
    if not outer:
        return None
    area = unary_union(outer)
    if rings['inner']:
        inner = [make_valid(p) for p in polygonize(unary_union(rings['inner']))]
        if inner:
            area = area.difference(unary_union(inner))
    return None if area.is_empty else area


def save(a, path):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(a).save(path)


def folder_arg():
    if len(sys.argv) < 2:
        raise SystemExit(f'usage: {sys.argv[0]} <map folder> [...]')
    return Map(sys.argv[1])


class Manifest:
    """downloads.json: per kept file, the exact request, its source and licence line, bytes, SHA-256 and time."""

    def __init__(self, m):
        import threading
        self.path = m.root / 'downloads.json'
        self.records = json.loads(self.path.read_text()) if self.path.exists() else {}
        self.lock = threading.Lock()

    def record(self, name, url, source, licence, data, method='GET', body=None):
        entry = {'url': url, 'method': method, 'source': source, 'licence': licence, 'bytes': len(data),
                 'sha256': hashlib.sha256(data).hexdigest(), 'retrieved_utc': dt.datetime.now(dt.timezone.utc).isoformat()}
        if body is not None:
            entry['body'] = body
        with self.lock:
            self.records[name] = entry
            self.save()

    def asked(self, name, url, method, body):
        """Whether the file kept as `name` answers this request: a POST by its body alone, as any of its servers answers it."""
        r = self.records.get(name)
        if r is None or r.get('method', 'GET') != method:
            return False
        return r.get('body') == body if body is not None else r.get('url') == url

    def save(self):
        # Whole or not at all, however many threads record at once.
        part = self.path.with_name(self.path.name + '.part')
        part.write_text(json.dumps(self.records, indent=2, sort_keys=True) + '\n')
        part.replace(self.path)


def get(url, params=None, data=None, tries=6, pause=4, timeout=300, accept=None):
    """One request at a time, with a growing pause between tries: the free services ask for it."""
    import requests
    last = None
    for attempt in range(tries):
        try:
            r = (requests.post if data is not None else requests.get)(url, params=params, data=data, timeout=timeout,
                                                                      headers={'User-Agent': CLIENT})
            if r.status_code in (429, 502, 503, 504):
                raise RuntimeError(f'{r.status_code}: {r.text[:200]}')
            r.raise_for_status()
            if accept and not accept(r.content):
                raise RuntimeError(f'unexpected answer: {r.content[:200]!r}')
            return r
        except Exception as e:
            last = e
            print(f'  try {attempt + 1} failed: {str(e)[:160]}; waiting {pause * 2 ** attempt} s', flush=True)
            time.sleep(pause * 2 ** attempt)
    raise RuntimeError(f'{url}: {last}')
