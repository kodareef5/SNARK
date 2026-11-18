"""The counties a cut touches, from the Census Bureau's TIGERweb: TIGER/Line's roads and water come a county a file, and
a cut of 16 km often crosses a county line. Printed as JSON for tools/maps/city.ts, which keeps it with the cut.
python tools/maps/counties.py <lon> <lat> <west> <south> <east> <north>   (the bounds in metres from lon, lat)"""
import json
import sys
from pathlib import Path
from pyproj import Transformer

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'mapdata'))
from common import get  # noqa: E402

COUNTIES = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/1/query'


def main():
    lon, lat, *bounds = map(float, sys.argv[1:7])
    to = Transformer.from_crs(f'+proj=tmerc +lat_0={lat} +lon_0={lon} +k=1 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs',
                              4326, always_xy=True)
    w, s, e, n = to.transform_bounds(*bounds, densify_pts=21)
    r = get(COUNTIES, params={'f': 'json', 'geometry': f'{w},{s},{e},{n}', 'geometryType': 'esriGeometryEnvelope', 'inSR': 4326,
                              'spatialRel': 'esriSpatialRelIntersects', 'outFields': 'GEOID,NAME,STATE', 'returnGeometry': 'false'},
            accept=lambda b: b'"features"' in b).json()
    found = sorted({(f['attributes']['GEOID'], f['attributes']['NAME']) for f in r['features']})
    if not found:
        raise SystemExit('no county under the cut: TIGER covers the United States only')
    print(json.dumps([{'geoid': g, 'name': nm} for g, nm in found]))


if __name__ == '__main__':
    main()
