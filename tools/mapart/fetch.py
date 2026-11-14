"""Fetch public geographic sources, with content hashes and exact request URLs."""
from pathlib import Path
import concurrent.futures as cf
import datetime as dt
import hashlib
import json
import threading
import time
import xml.etree.ElementTree as ET
import requests
from pyproj import Transformer

ROOT = Path(__file__).resolve().parents[2] / 'assets/source/maps/miami'
RAW = ROOT / 'raw'
CFG = json.loads((ROOT / 'map.json').read_text())
LOCK = threading.Lock()
MANIFEST = ROOT / 'downloads.json'
records = json.loads(MANIFEST.read_text()) if MANIFEST.exists() else {}

def fetch(url, name, params=None, source='metadata'):
    path = RAW / name
    path.parent.mkdir(parents=True, exist_ok=True)
    full = requests.Request('GET', url, params=params).prepare().url
    if not path.exists():
        for attempt in range(4):
            try:
                r = requests.get(full, timeout=120)
                r.raise_for_status()
                path.write_bytes(r.content)
                break
            except Exception:
                if attempt == 3: raise
                time.sleep(1 + attempt)
    data = path.read_bytes()
    with LOCK:
        records[name] = {'url': full, 'source': source, 'bytes': len(data),
                         'sha256': hashlib.sha256(data).hexdigest(),
                         'retrieved_utc': dt.datetime.now(dt.timezone.utc).isoformat()}
        MANIFEST.write_text(json.dumps(records, indent=2, sort_keys=True))
    return path

def dem():
    base = 'https://noaa-nos-coastal-lidar-pds.s3.amazonaws.com/dem/FL_Miami_Dade_DEM_2021_10339/'
    vrt = fetch(base+'FL_Miami_Dade_DEM_2021_m10339_EPSG-6438.vrt', 'dem/index.vrt', source='NOAA DEM 2021 CC0')
    fetch(base+'fl2021_miami_dade_dem_m10339_met.xml', 'dem/metadata.xml', source='NOAA DEM 2021 CC0')
    tree = ET.parse(vrt)
    gt = list(map(float, tree.findtext('GeoTransform').split(',')))
    t = Transformer.from_crs(CFG['crs_wkt'], 6438, always_xy=True)
    b = t.transform_bounds(*CFG['bounds'], densify_pts=21)
    selected = []
    for node in tree.findall('.//ComplexSource'):
        d = node.find('DstRect').attrib
        x0 = gt[0]+float(d['xOff'])*gt[1]
        x1 = x0+float(d['xSize'])*gt[1]
        y1 = gt[3]+float(d['yOff'])*gt[5]
        y0 = y1+float(d['ySize'])*gt[5]
        if x1 >= b[0]-10 and x0 <= b[2]+10 and y1 >= b[1]-10 and y0 <= b[3]+10:
            selected.append(node.findtext('SourceFilename'))
    (ROOT/'dem_selection.json').write_text(json.dumps(selected, indent=2))
    print('DEM selected:', len(selected), flush=True)
    with cf.ThreadPoolExecutor(10) as pool:
        for i, _ in enumerate(pool.map(lambda n:fetch(base+n,'dem/'+n,source='NOAA DEM 2021 CC0'), selected)):
            if i % 50 == 0: print('DEM',i,'/',len(selected),flush=True)
    print('DEM done',flush=True)

def tiger(kind):
    filename=f'tl_2025_12086_{kind}.zip'
    fetch(f'https://www2.census.gov/geo/tiger/TIGER2025/{kind.upper()}/'+filename,
          filename,source='Census TIGER/Line 2025 public domain')
    print(kind,'done',flush=True)

def nlcd():
    t=Transformer.from_crs(CFG['crs_wkt'],3857,always_xy=True)
    b=t.transform_bounds(*CFG['bounds'],densify_pts=21)
    fetch('https://www.mrlc.gov/geoserver/mrlc_display/NLCD_2021_Land_Cover_L48/ows',
          'nlcd2021.tif',params={'service':'WCS','version':'1.0.0','request':'GetCoverage',
          'coverage':'NLCD_2021_Land_Cover_L48','crs':'EPSG:3857','bbox':','.join(map(str,b)),
          'resx':30,'resy':30,'format':'GeoTIFF'},source='USGS NLCD 2021 public domain')
    print('NLCD done',flush=True)

def buildings():
    base='https://services2.arcgis.com/FiaPA4ga0iQKduv3/arcgis/rest/services/USA_Structures_View/FeatureServer/0'
    fetch(base,'fema/layer.json',params={'f':'json'},source='FEMA USA Structures metadata')
    t=Transformer.from_crs(CFG['crs_wkt'],4326,always_xy=True)
    b=t.transform_bounds(*CFG['bounds'],densify_pts=21)
    params={'f':'json','where':'1=1','geometry':','.join(map(str,b)),
            'geometryType':'esriGeometryEnvelope','inSR':4326,
            'spatialRel':'esriSpatialRelIntersects','returnIdsOnly':'true'}
    ids=json.loads(fetch(base+'/query','fema/ids.json',params,source='FEMA USA Structures').read_text())
    if 'error' in ids: raise RuntimeError(ids)
    oid=ids['objectIdFieldName']; ids=sorted(ids['objectIds'])
    print('FEMA count',len(ids),flush=True)
    chunks=[ids[i:i+100] for i in range(0,len(ids),100)]
    def part(item):
        i,chunk=item
        p={'f':'json','objectIds':','.join(map(str,chunk)),'outFields':oid,
           'returnGeometry':'true','outSR':4326}
        path=fetch(base+'/query',f'fema/page_{i:03}.json',p,source='FEMA USA Structures footprints')
        data=json.loads(path.read_text())
        if 'error' in data or len(data.get('features',[]))!=len(chunk):raise RuntimeError('Incomplete FEMA page '+str(i))
    with cf.ThreadPoolExecutor(5) as pool:list(pool.map(part,enumerate(chunks)))
    print('FEMA done',flush=True)

if __name__=='__main__':
    jobs=[dem,lambda:tiger('roads'),lambda:tiger('areawater'),nlcd,buildings]
    with cf.ThreadPoolExecutor(5) as pool:
        fs=[pool.submit(job) for job in jobs]
        for f in cf.as_completed(fs):
            try:f.result()
            except Exception as e:print('FAILED',repr(e),flush=True)
