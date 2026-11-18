"""Freeze a map's coastal elevation model subset as a lossless Float32 GeoTIFF in base/bathymetry, as round3_bathy.py did
Miami's: the georeference comes from the response's own longitude and latitude arrays, not its stale regional bounds.
Fetch first (fetch.py bathymetry). python tools/mapdata/bathy.py <map folder>"""
import hashlib
import json
import sys
from pathlib import Path
import numpy as np
import rasterio
from affine import Affine
from rasterio.warp import Resampling, reproject
from scipy.io import netcdf_file

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import Manifest, folder_arg  # noqa: E402


def main():
    m = folder_arg()
    c = m.city.get('bathymetry')
    if not c:
        print('bathymetry: none, the frame has no sea')
        return
    raw = m.raw / 'bathymetry' / c['url'].rsplit('/', 1)[1]
    with netcdf_file(raw, mmap=False) as f:
        lon = f.variables['lon'][:].copy()
        lat = f.variables['lat'][:].copy()
        a = f.variables['Band1'][:].copy()[::-1].astype(np.float32)
    dx = float(np.median(np.diff(lon)))
    dy = float(np.median(np.diff(lat)))
    tx = Affine(dx, 0, float(lon[0] - dx / 2), 0, -dy, float(lat[-1] + dy / 2))
    dest = m.base / 'bathymetry' / c['file']
    dest.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.open(dest, 'w', driver='GTiff', height=a.shape[0], width=a.shape[1], count=1, dtype='float32',
                       crs='EPSG:4326', transform=tx, nodata=-99999, compress='deflate', predictor=3) as ds:
        ds.write(a, 1)
    grid = np.empty(m.shape, np.float32)
    with rasterio.open(dest) as ds:
        reproject(rasterio.band(ds, 1), grid, src_transform=ds.transform, src_crs=ds.crs, dst_transform=m.grid,
                  dst_crs=m.crs, resampling=Resampling.bilinear)
    from PIL import Image
    w = np.asarray(Image.open(m.base / 'water.png')) > 0
    rec = Manifest(m).records.get('bathymetry/' + raw.name, {})
    info = {'source': c['source'], 'licence': c['licence'], 'request': rec.get('url'), 'raw_sha256': rec.get('sha256'),
            'raw_bytes': rec.get('bytes'), 'shape': list(a.shape), 'spacing_deg': [dx, dy],
            'pixel_centre_bounds': [float(lon[0]), float(lat[0]), float(lon[-1]), float(lat[-1])],
            'georeference': 'Pixel centres from the lon/lat arrays, WGS84; the stale regional actual_range attributes are ignored.',
            'retained_geotiff_sha256': hashlib.sha256(dest.read_bytes()).hexdigest(),
            'water_elevation_percentiles_m_navd88': np.percentile(grid[w], [0, 5, 25, 50, 75, 95, 100]).tolist(),
            'nonnegative_on_tiger_water': float(np.mean(grid[w] >= 0))}
    (dest.parent / 'source.json').write_text(json.dumps(info, indent=2) + '\n')
    print(json.dumps(info, indent=2))


if __name__ == '__main__':
    main()
