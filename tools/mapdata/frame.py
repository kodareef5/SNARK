"""Write a map's frame, map.json, from its city.json: a local Transverse Mercator rectangle on WGS84 round `centre`, a
square of `size_m` there or the `bounds` given (west, south, east and north in metres from the centre, whole chunks), its
south-east corner at `frame` on the lattice (shared/coords.ts; the middle, 2048 and 2048, unless given). Run once before
fetching; the download selection and every layer follow from it. Refuses to move an existing frame."""
import json
import sys
from pathlib import Path
from pyproj import CRS, Transformer

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import folder_arg  # noqa: E402


def main():
    m = folder_arg()
    lon, lat = m.city['centre']
    chunk, spacing = m.city.get('chunk_m', 64), m.city.get('spacing_m', 2)
    h = m.city.get('size_m', 8128) // 2
    west, south, east, north = m.city.get('bounds', [-h, -h, h, h])
    width, depth = east - west, north - south
    if width % chunk or depth % chunk:
        raise SystemExit(f'bounds {west, south, east, north} are not whole chunks of {chunk} m')
    proj = f'+proj=tmerc +lat_0={lat} +lon_0={lon} +k=1 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs +type=crs'
    crs = CRS.from_proj4(proj)
    to = Transformer.from_crs(crs, 4326, always_xy=True)
    corners = {k: list(to.transform(x, y)) for k, (x, y) in
               {'NW': (west, north), 'NE': (east, north), 'SE': (east, south), 'SW': (west, south)}.items()}
    cfg = {'size_m': [width, depth], 'chunks': [width // chunk, depth // chunk], 'chunk_m': chunk,
           'grid_samples': [width // spacing + 1, depth // spacing + 1], 'spacing_m': spacing,
           'frame': m.city.get('frame', [2048, 2048]), 'crs_wkt': crs.to_wkt(), 'crs_proj': proj, 'bounds': [west, south, east, north],
           'corners_lon_lat': corners,
           'north': 'grid north; true north on central meridian',
           'pixel_convention': 'images pixel-is-area; base PNG samples at grid vertices, inclusive endpoints',
           'center_lon_lat': [lon, lat]}
    if m.city.get('bathymetry'):
        cfg['bathymetry'] = f"bathymetry/{m.city['bathymetry']['file']}"
    # height.png holds centimetres over this height, -100 m unless a city's ground stands higher than 555 m.
    if 'height_zero_m' in m.city:
        cfg['height_zero_m'] = m.city['height_zero_m']
    path = m.root / 'map.json'
    held = json.loads(path.read_text()) if path.exists() else None
    if held and [held['center_lon_lat'], held['bounds'], held.get('frame')] != [cfg['center_lon_lat'], cfg['bounds'], cfg['frame']] and '--force' not in sys.argv:
        raise SystemExit('map.json already holds another frame; the downloads and layers follow it (--force to move it)')
    path.write_text(json.dumps(cfg, indent=2) + '\n')
    print(json.dumps(corners))


if __name__ == '__main__':
    main()
