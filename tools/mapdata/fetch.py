"""Download a map's public sources as its city.json names them, for the frame in its map.json, into raw/ (ignored by git),
recording every kept file's request, source, licence line, bytes and SHA-256 in downloads.json. Reuses what is there.
python tools/mapdata/fetch.py <map folder> [tiger dem nlcd fema bathymetry osm]   (default: all, one after another)"""
import json
import math
import sys
import zipfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import xml.etree.ElementTree as ET
import requests
from pyproj import Transformer

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from common import Manifest, folder_arg, get  # noqa: E402


def keep(m, man, name, url, source, licence, params=None, data=None, accept=None, method=None):
    path = m.raw / name
    full = requests.Request('GET', url, params=params).prepare().url if data is None else url
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        r = get(url, params=params, data=data, accept=accept)
        path.write_bytes(r.content)
    if name not in man.records:
        man.record(name, full, source, licence, path.read_bytes(), method or ('POST' if data is not None else 'GET'), data)
    return path


def tiger(m, man):
    t = m.city['tiger']
    for layer in t['layers']:
        name = f"tl_{t['year']}_{t['county']}_{layer}.zip"
        p = keep(m, man, name, f"https://www2.census.gov/geo/tiger/TIGER{t['year']}/{layer.upper()}/{name}", t['source'], t['licence'])
        zipfile.ZipFile(p).testzip()
        print('tiger', layer, p.stat().st_size, flush=True)


def dem(m, man):
    d = m.city['dem']
    if d['kind'] == 'tnm':
        w, s, e, n = m.lonlat_bounds(0.002)
        items, offset = [], 0
        while True:
            page = get('https://tnmaccess.nationalmap.gov/api/v1/products', params={
                'datasets': d['dataset'], 'bbox': f'{w},{s},{e},{n}', 'max': 500, 'offset': offset, 'outputFormat': 'JSON'}).json()
            items += page['items']
            offset += len(page['items'])
            if not page['items'] or offset >= page['total']:
                break
        items = sorted((i for i in items if d['project'] in i['downloadURL']), key=lambda i: i['downloadURL'])
        tiles = [{'name': i['downloadURL'].rsplit('/', 1)[1], 'url': i['downloadURL'], 'metadata': i.get('vendorMetaUrl'),
                  'bounds': i['boundingBox'], 'published': i.get('publicationDate')} for i in items]
    elif d['kind'] == 'noaa-vrt':
        vrt = keep(m, man, 'dem/index.vrt', d['base'] + d['vrt'], d['source'], d['licence'])
        tree = ET.parse(vrt)
        gt = list(map(float, tree.findtext('GeoTransform').split(',')))
        b = Transformer.from_crs(m.crs, d['epsg'], always_xy=True).transform_bounds(*m.b, densify_pts=21)
        tiles = []
        for node in tree.findall('.//ComplexSource'):
            r = node.find('DstRect').attrib
            x0 = gt[0] + float(r['xOff']) * gt[1]
            x1 = x0 + float(r['xSize']) * gt[1]
            y1 = gt[3] + float(r['yOff']) * gt[5]
            y0 = y1 + float(r['ySize']) * gt[5]
            if x1 >= b[0] - 10 and x0 <= b[2] + 10 and y1 >= b[1] - 10 and y0 <= b[3] + 10:
                f = node.findtext('SourceFilename')
                tiles.append({'name': f, 'url': d['base'] + f})
    else:
        raise ValueError(f"unknown elevation source kind {d['kind']}")
    (m.root / 'dem_selection.json').write_text(json.dumps(tiles, indent=1) + '\n')
    print('DEM tiles selected:', len(tiles), flush=True)
    if tiles and tiles[0].get('metadata'):
        keep(m, man, 'dem/' + tiles[0]['name'].replace('.tif', '.xml'), tiles[0]['metadata'], d['source'], d['licence'])
    with ThreadPoolExecutor(4) as pool:
        for k, _ in enumerate(pool.map(lambda t: keep(m, man, 'dem/' + t['name'], t['url'], d['source'], d['licence']), tiles)):
            if k % 10 == 0:
                print('DEM', k, '/', len(tiles), flush=True)
    print('DEM done', flush=True)


def nlcd(m, man):
    c = m.city['nlcd']
    b = Transformer.from_crs(m.crs, 3857, always_xy=True).transform_bounds(*m.b, densify_pts=21)
    keep(m, man, c['file'], c['url'], c['source'], c['licence'], params={
        'service': 'WCS', 'version': '1.0.0', 'request': 'GetCoverage', 'coverage': c['coverage'], 'crs': 'EPSG:3857',
        'bbox': ','.join(map(str, b)), 'resx': 30, 'resy': 30, 'format': 'GeoTIFF'}, accept=lambda b: b[:2] in (b'II', b'MM'))
    print('NLCD done', flush=True)


def fema(m, man):
    f = m.city['footprints']
    base = f['service']
    keep(m, man, 'fema/layer.json', base, f['source'], f['licence'], params={'f': 'json'})
    w, s, e, n = Transformer.from_crs(m.crs, 4326, always_xy=True).transform_bounds(*m.b, densify_pts=21)
    ids = json.loads(keep(m, man, 'fema/ids.json', base + '/query', f['source'], f['licence'], params={
        'f': 'json', 'where': '1=1', 'geometry': f'{w},{s},{e},{n}', 'geometryType': 'esriGeometryEnvelope', 'inSR': 4326,
        'spatialRel': 'esriSpatialRelIntersects', 'returnIdsOnly': 'true'}).read_text())
    if 'error' in ids:
        raise RuntimeError(ids)
    oid = ids['objectIdFieldName']
    ids = sorted(ids['objectIds'])
    print('footprints', len(ids), flush=True)
    for i in range(0, len(ids), 100):
        chunk = ids[i:i + 100]
        p = keep(m, man, f'fema/page_{i // 100:03}.json', base + '/query', f['source'], f['licence'], params={
            'f': 'json', 'objectIds': ','.join(map(str, chunk)), 'outFields': oid, 'returnGeometry': 'true', 'outSR': 4326})
        if len(json.loads(p.read_text()).get('features', [])) != len(chunk):
            p.unlink()
            raise RuntimeError(f'incomplete footprint page {i // 100}')
    print('footprints done', flush=True)


def bathymetry(m, man):
    c = m.city['bathymetry']
    w, s, e, n = m.lonlat_bounds(c.get('margin_deg', 0.006))
    keep(m, man, 'bathymetry/' + c['url'].rsplit('/', 1)[1], c['url'], c['source'], c['licence'], params={
        'var': 'Band1', 'north': round(n, 3), 'south': round(s, 3), 'west': round(w, 3), 'east': round(e, 3),
        'horizStride': 1, 'accept': 'netcdf'}, accept=lambda b: b[:3] == b'CDF')
    print('bathymetry done', flush=True)


def osm(m, man):
    o = m.city['osm']
    w, s, e, n = m.lonlat_bounds()
    bbox = f'{math.floor(s * 1e4) / 1e4},{math.floor(w * 1e4) / 1e4},{math.ceil(n * 1e4) / 1e4},{math.ceil(e * 1e4) / 1e4}'
    for name in ['osm', 'ways']:
        query = (HERE / f'{name}.overpassql').read_text().replace('{bbox}', bbox)
        (m.root / 'blocks').mkdir(exist_ok=True)
        (m.root / 'blocks' / f'{name}.overpassql').write_text(query)
        target = f"osm/{'all' if name == 'osm' else 'ways'}.json"
        if (m.raw / target).exists():
            continue
        for server in o['servers']:
            try:
                keep(m, man, target, server, o['source'], o['licence'], data={'data': query},
                     accept=lambda b: b.lstrip()[:1] == b'{' and b'"remark"' not in b[-400:])
                break
            except Exception as ex:
                print(f'  {server} gave up: {str(ex)[:160]}', flush=True)
        else:
            raise RuntimeError('no Overpass server answered ' + name)
        print('osm', name, 'done', flush=True)


JOBS = {'tiger': tiger, 'dem': dem, 'nlcd': nlcd, 'fema': fema, 'bathymetry': bathymetry, 'osm': osm}

if __name__ == '__main__':
    m = folder_arg()
    man = Manifest(m)
    for job in sys.argv[2:] or list(JOBS):
        JOBS[job](m, man)
