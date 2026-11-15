"""Write a map's frame, map.json, from the centre and size in its city.json: a local Transverse Mercator square on WGS84.
Run once before fetching; the download selection and every layer follow from it. Refuses to move an existing frame."""
import json
import sys
from pathlib import Path
from pyproj import CRS, Transformer

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import folder_arg  # noqa: E402


def main():
    m = folder_arg()
    lon, lat = m.city['centre']
    size, chunk = m.city.get('size_m', 8128), m.city.get('chunk_m', 64)
    spacing = m.city.get('spacing_m', 2)
    proj = f'+proj=tmerc +lat_0={lat} +lon_0={lon} +k=1 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs +type=crs'
    crs = CRS.from_proj4(proj)
    h = size // 2
    to = Transformer.from_crs(crs, 4326, always_xy=True)
    corners = {k: list(to.transform(x, y)) for k, (x, y) in
               {'NW': (-h, h), 'NE': (h, h), 'SE': (h, -h), 'SW': (-h, -h)}.items()}
    cfg = {'size_m': size, 'chunks': size // chunk, 'chunk_m': chunk, 'grid_samples': size // spacing + 1,
           'spacing_m': spacing, 'crs_wkt': crs.to_wkt(), 'crs_proj': proj, 'bounds': [-h, -h, h, h],
           'corners_lon_lat': corners,
           'north': 'grid north; true north on central meridian',
           'pixel_convention': 'images pixel-is-area; base PNG samples at grid vertices, inclusive endpoints',
           'center_lon_lat': [lon, lat]}
    path = m.root / 'map.json'
    if path.exists() and json.loads(path.read_text())['center_lon_lat'] != cfg['center_lon_lat'] and '--force' not in sys.argv:
        raise SystemExit('map.json already holds another frame; the downloads and layers follow it (--force to move it)')
    path.write_text(json.dumps(cfg, indent=2) + '\n')
    print(json.dumps(corners))


if __name__ == '__main__':
    main()
