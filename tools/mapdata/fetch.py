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
    """The file `name` as this request answers it: fetched where it is not kept, or was kept for another request."""
    path = m.raw / name
    full = requests.Request('GET', url, params=params).prepare().url if data is None else url
    method = method or ('POST' if data is not None else 'GET')
    if path.exists() and man.asked(name, full, method, data) and man.records[name]['bytes'] == path.stat().st_size:
        return path
    path.parent.mkdir(parents=True, exist_ok=True)
    r = get(url, params=params, data=data, accept=accept)
    # Whole or not there: a write cut short is never taken for the download.
    part = path.with_name(path.name + '.part')
    part.write_bytes(r.content)
    part.replace(path)
    man.record(name, full, source, licence, r.content, method, data)
    return path


def tiger(m, man):
    t = m.city['tiger']
    for county in t['counties']:
        for layer in t['layers']:
            name = f"tl_{t['year']}_{county}_{layer}.zip"
            p = keep(m, man, name, f"https://www2.census.gov/geo/tiger/TIGER{t['year']}/{layer.upper()}/{name}", t['source'], t['licence'])
            zipfile.ZipFile(p).testzip()
            print('tiger', county, layer, p.stat().st_size, flush=True)


def dem(m, man):
    # The newest project first; older ones named in "fill" only cover what it leaves bare, as a frame past its county.
    main = m.city['dem']
    tiles = []
    for k, d in enumerate([main] + main.get('fill', [])):
        d = {**main, 'fill': None, **d}
        for t in dem_tiles(m, man, d):
            tiles.append({**t, 'project': d.get('project'), 'z_to_m': d['z_to_m'], 'fill': k > 0})
    (m.root / 'dem_selection.json').write_text(json.dumps(tiles, indent=1) + '\n')
    print('DEM tiles selected:', len(tiles), flush=True)
    for d in [main] + main.get('fill', []):
        first = next((t for t in tiles if t['project'] == d.get('project')), None)
        # Some projects name an index page rather than a metadata file.
        if first and (first.get('metadata') or '').endswith('.xml'):
            keep(m, man, 'dem/' + first['name'].replace('.tif', '.xml'), first['metadata'], d.get('source', main['source']), d.get('licence', main['licence']))
    sources = {d.get('project'): (d.get('source', main['source']), d.get('licence', main['licence'])) for d in [main] + main.get('fill', [])}
    with ThreadPoolExecutor(4) as pool:
        for k, _ in enumerate(pool.map(lambda t: keep(m, man, 'dem/' + t['name'], t['url'], *sources[t['project']]), tiles)):
            if k % 10 == 0:
                print('DEM', k, '/', len(tiles), flush=True)
    print('DEM done', flush=True)


def dem_tiles(m, man, d):
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
    return tiles


def nlcd(m, man):
    c = m.city['nlcd']
    b = Transformer.from_crs(m.crs, 3857, always_xy=True).transform_bounds(*m.b, densify_pts=21)
    keep(m, man, c['file'], c['url'], c['source'], c['licence'], params={
        'service': 'WCS', 'version': '1.0.0', 'request': 'GetCoverage', 'coverage': c['coverage'], 'crs': 'EPSG:3857',
        'bbox': ','.join(map(str, b)), 'resx': 30, 'resy': 30, 'format': 'GeoTIFF'}, accept=lambda b: b[:2] in (b'II', b'MM'))
    print('NLCD done', flush=True)


# What the attributes stage keeps of each footprint (tools/mapworld/fetch-attributes.ts), asked for with its outline.
FEMA_FIELDS = ['OBJECTID', 'HEIGHT', 'OCC_CLS', 'PRIM_OCC', 'SEC_OCC', 'OUTBLDG', 'SQMETERS', 'SOURCE', 'VAL_METHOD', 'IMAGE_DATE']


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
            'f': 'json', 'objectIds': ','.join(map(str, chunk)), 'outFields': ','.join(dict.fromkeys([oid, *FEMA_FIELDS])), 'returnGeometry': 'true', 'outSR': 4326})
        if len(json.loads(p.read_text()).get('features', [])) != len(chunk):
            p.unlink()
            raise RuntimeError(f'incomplete footprint page {i // 100}')
    print('footprints done', flush=True)


def bathymetry(m, man):
    c = m.city.get('bathymetry')
    if not c:
        print('bathymetry: none, the frame has no sea', flush=True)
        return
    w, s, e, n = m.lonlat_bounds(c.get('margin_deg', 0.006))
    keep(m, man, 'bathymetry/' + c['url'].rsplit('/', 1)[1], c['url'], c['source'], c['licence'], params={
        'var': 'Band1', 'north': round(n, 3), 'south': round(s, 3), 'west': round(w, 3), 'east': round(e, 3),
        'horizStride': 1, 'accept': 'netcdf'}, accept=lambda b: b[:3] == b'CDF')
    print('bathymetry done', flush=True)


def overpass(m, man, target, query):
    """One Overpass query kept as `target`, asked of each server in turn until one answers whole."""
    o = m.city['osm']
    if (m.raw / target).exists() and man.asked(target, None, 'POST', {'data': query}):
        return
    for server in o['servers']:
        try:
            keep(m, man, target, server, o['source'], o['licence'], data={'data': query},
                 accept=lambda b: b.lstrip()[:1] == b'{' and b'"remark"' not in b[-400:])
            return
        except Exception as ex:
            print(f'  {server} gave up: {str(ex)[:160]}', flush=True)
    raise RuntimeError('no Overpass server answered ' + target)


def bbox_of(s, w, n, e):
    return f'{math.floor(s * 1e4) / 1e4},{math.floor(w * 1e4) / 1e4},{math.ceil(n * 1e4) / 1e4},{math.ceil(e * 1e4) / 1e4}'


# The streets query asks for every highway with its shape: over a 16 km cut one answer runs to hundreds of megabytes
# and the busy public servers time it out (Tampa's 8 km square: no answer in 25 minutes, 2026-11-18). Asked a tile of
# about 4 km at a time, each answer is small, a refusal costs one tile, and the tiles kept make a run resumable.
STREET_TILE_DEG = 0.036


def osm_extract(m, man, names):
    """Every OpenStreetMap file from the city's regional extract (osm_local.py), as the Overpass queries would give them."""
    import datetime as dt
    import osm_local
    import hashlib
    files = {name: m.raw / f"osm/{'all' if name == 'osm' else name}.json" for name in names}
    o = m.city['osm']
    pbf = osm_local.region_file(HERE.parents[1] / 'var/osm-extracts', o['extract'])
    # The answers are the extract's and the queries': kept while both are the same, made again (seconds) when either
    # changes, where a file being there kept an answer to a query since edited.
    md5_file = Path(str(pbf) + '.md5')
    stamp = hashlib.sha256(b''.join([(HERE / 'osm_local.py').read_bytes(), *[q.read_bytes() for q in sorted(HERE.glob('*.overpassql'))],
                                     md5_file.read_bytes() if md5_file.exists() else str(pbf.stat().st_mtime).encode(), ' '.join(names).encode()])).hexdigest()
    stamp_file = m.raw / 'osm/answers.key'
    if all(f.exists() for f in files.values()) and stamp_file.exists() and stamp_file.read_text() == stamp:
        return
    area = m.raw / 'osm/area.osm.pbf'
    area.parent.mkdir(parents=True, exist_ok=True)
    osm_local.cut(pbf, m.lonlat_bounds(0.002), area)
    answers = osm_local.answer(area, ['all' if n == 'osm' else n for n in names])
    for name, path in files.items():
        part = path.with_name(path.name + '.part')
        part.write_text(json.dumps(answers['all' if name == 'osm' else name], separators=(',', ':')))
        part.replace(path)
        print('osm', name, len(answers['all' if name == 'osm' else name]['elements']), 'elements', flush=True)
    stamp_file.write_text(stamp)
    md5 = Path(str(pbf) + '.md5').read_text().split()[0] if Path(str(pbf) + '.md5').exists() else None
    man.records['osm/extract'] = {'url': f"https://download.geofabrik.de/{o['extract']}-latest.osm.pbf", 'method': 'GET',
                                  'source': o['source'] + ', through Geofabrik\'s regional extract', 'licence': o['licence'],
                                  'bytes': pbf.stat().st_size, 'md5': md5,
                                  'retrieved_utc': dt.datetime.fromtimestamp(pbf.stat().st_mtime, dt.timezone.utc).isoformat(),
                                  'note': 'cut to the frame with osmium extract --strategy smart; raw/osm/*.json answered locally (osm_local.py)'}
    man.save()


def osm(m, man):
    w, s, e, n = m.lonlat_bounds()
    bbox = bbox_of(s, w, n, e)
    # features: building parts, water standing above any sea, pools, fountains, runways and wheels, with their shapes.
    names = ['osm', 'ways'] + (['buildings'] if m.city['footprints'].get('split_by_osm') else []) + ['features']
    (m.root / 'blocks').mkdir(exist_ok=True)
    if m.city['osm'].get('extract'):
        osm_extract(m, man, names + ['streets'])
        return
    for name in names:
        query = (HERE / f'{name}.overpassql').read_text().replace('{bbox}', bbox)
        (m.root / 'blocks' / f'{name}.overpassql').write_text(query)
        overpass(m, man, f"osm/{'all' if name == 'osm' else name}.json", query)
        print('osm', name, 'done', flush=True)
    # streets: every highway with its tags and shape, crossings, signals, entrances, lots, land use, parks, plazas and
    # beaches, by tiles, then joined: a way that crosses a tile's edge comes whole in each tile's answer and is kept once.
    merged = m.raw / 'osm/streets.json'
    template = (HERE / 'streets.overpassql').read_text()
    (m.root / 'blocks/streets.overpassql').write_text(template)
    rows = max(1, math.ceil((n - s) / STREET_TILE_DEG))
    cols = max(1, math.ceil((e - w) / (STREET_TILE_DEG / math.cos(math.radians((s + n) / 2)))))
    seen, elements = set(), []
    for r in range(rows):
        for c in range(cols):
            ts, tn = s + (n - s) * r / rows, s + (n - s) * (r + 1) / rows
            tw, te = w + (e - w) * c / cols, w + (e - w) * (c + 1) / cols
            target = f'osm/streets/{r}_{c}.json'
            overpass(m, man, target, template.replace('{bbox}', bbox_of(ts, tw, tn, te)))
            for el in json.loads((m.raw / target).read_text())['elements']:
                if (el['type'], el['id']) not in seen:
                    seen.add((el['type'], el['id']))
                    elements.append(el)
            print(f'osm streets tile {r * cols + c + 1} of {rows * cols}', flush=True)
    merged.write_text(json.dumps({'elements': elements}, separators=(',', ':')))
    print('osm streets done:', len(elements), 'elements', flush=True)


JOBS = {'tiger': tiger, 'dem': dem, 'nlcd': nlcd, 'fema': fema, 'bathymetry': bathymetry, 'osm': osm}

if __name__ == '__main__':
    m = folder_arg()
    man = Manifest(m)
    for job in sys.argv[2:] or list(JOBS):
        JOBS[job](m, man)
