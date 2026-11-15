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

CLIENT = 'snark-mapdata/1.0'


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
            self.size = self.cfg['size_m']
            self.n = self.cfg['grid_samples']
            self.grid = Affine(self.cfg['spacing_m'], 0, self.b[0] - 1, 0, -self.cfg['spacing_m'], self.b[3] + 1)

    def transform(self, n):
        return Affine(self.size / n, 0, self.b[0], 0, -self.size / n, self.b[3])

    def lonlat_bounds(self, margin=0.0):
        c = self.cfg['corners_lon_lat']
        lons = [p[0] for p in c.values()]
        lats = [p[1] for p in c.values()]
        return min(lons) - margin, min(lats) - margin, max(lons) + margin, max(lats) + margin

    def vectors(self, name):
        from shapely.geometry import shape
        data = json.loads((self.base / f'{name}.geojson').read_text())
        return [(shape(f['geometry']), f['properties']) for f in data['features']]

    def burn(self, items, n, tx=None):
        from rasterio.features import rasterize
        items = list(items)
        if not items:
            return np.zeros((n, n), np.uint8)
        return rasterize(items, out_shape=(n, n), transform=tx or self.transform(n), fill=0, dtype='uint8')

    def write_features(self, name, features, folder=None):
        from shapely.geometry import mapping
        (folder or self.base).mkdir(parents=True, exist_ok=True)
        ((folder or self.base) / f'{name}.geojson').write_text(json.dumps({
            'type': 'FeatureCollection', 'name': name,
            'crs': {'type': 'name', 'properties': {'name': self.cfg['crs_proj']}},
            'features': [{'type': 'Feature', 'geometry': mapping(g), 'properties': p} for g, p in features]}, separators=(',', ':')))


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
        self.path = m.root / 'downloads.json'
        self.records = json.loads(self.path.read_text()) if self.path.exists() else {}

    def record(self, name, url, source, licence, data, method='GET', body=None):
        self.records[name] = {'url': url, 'method': method, 'source': source, 'licence': licence, 'bytes': len(data),
                              'sha256': hashlib.sha256(data).hexdigest(),
                              'retrieved_utc': dt.datetime.now(dt.timezone.utc).isoformat()}
        if body is not None:
            self.records[name]['body'] = body
        self.path.write_text(json.dumps(self.records, indent=2, sort_keys=True) + '\n')


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
