"""Acquire and freeze NOAA bathymetry; render a depth guide, never a new coast.

The NCSS response retains the full dataset's stale actual_range attributes.
Read lon/lat coordinate arrays explicitly. NOAA identifies the horizontal datum
as WGS84; the inconsistent spherical grid_mapping attribute is not used.
"""
import hashlib, json
from datetime import datetime, timezone
import requests
import numpy as np
import rasterio
from rasterio.warp import reproject, Resampling
from affine import Affine
from scipy.io import netcdf_file
from PIL import Image
from common import ROOT, CRS, transform

URL='https://www.ngdc.noaa.gov/thredds/ncss/grid/regional/miami_13_navd88_2015.nc'
PARAMS=dict(var='Band1',north=25.822,south=25.738,west=-80.212,east=-80.120,horizStride=1,accept='netcdf')
DEPTHS=np.array([0,.7,1.6,2.8,4.5,7,12,18])
COLORS=np.array([[166,190,165],[154,184,163],[132,172,157],[111,160,151],
                 [96,148,144],[81,133,134],[68,116,124],[63,108,117]],np.float32)

def depth_at(n):
    dst=np.empty((n,n),np.float32)
    with rasterio.open(ROOT/'base/bathymetry/miami-navd88.tif') as ds:
        reproject(rasterio.band(ds,1),dst,src_transform=ds.transform,src_crs=ds.crs,
                  dst_transform=transform(n),dst_crs=CRS,resampling=Resampling.bilinear)
    return np.maximum(-dst,0)

def pigment(n):
    depth=depth_at(n)
    return np.stack([np.interp(depth,DEPTHS,COLORS[:,k]) for k in range(3)],-1).astype(np.float32)

def main():
    raw=ROOT/'raw/round3/miami-bathy-subset.nc';raw.parent.mkdir(parents=True,exist_ok=True)
    if not raw.exists():
        r=requests.get(URL,params=PARAMS,timeout=120);r.raise_for_status();raw.write_bytes(r.content)
    with netcdf_file(raw,mmap=False) as f:
        lon=f.variables['lon'][:].copy();lat=f.variables['lat'][:].copy()
        a=f.variables['Band1'][:].copy()[::-1].astype(np.float32)
    dx=float(np.median(np.diff(lon)));dy=float(np.median(np.diff(lat)))
    assert abs(dx-1/10800)<1e-9 and abs(dy-1/10800)<1e-9
    tx=Affine(dx,0,float(lon[0]-dx/2),0,-dy,float(lat[-1]+dy/2))
    dest=ROOT/'base/bathymetry/miami-navd88.tif';dest.parent.mkdir(parents=True,exist_ok=True)
    with rasterio.open(dest,'w',driver='GTiff',height=a.shape[0],width=a.shape[1],count=1,
                       dtype='float32',crs='EPSG:4326',transform=tx,nodata=-99999,
                       compress='deflate',predictor=3) as ds:ds.write(a,1)
    p=ROOT/'reports/round3/bathymetry-source.json'
    log=json.loads(p.read_text()) if p.exists() else {}
    log.update(url=requests.Request('GET',URL,params=PARAMS).prepare().url,
        sha256=hashlib.sha256(raw.read_bytes()).hexdigest(),bytes=raw.stat().st_size,
        subset_shape=list(a.shape),coordinate_array_bounds=[float(lon[0]),float(lat[0]),float(lon[-1]),float(lat[-1])],
        corrected_georeference='Pixel centres from lon/lat arrays, WGS84 per NOAA documentation. Ignore stale full-grid actual_range and spherical grid_mapping.',
        retained_geotiff_sha256=hashlib.sha256(dest.read_bytes()).hexdigest())
    d=depth_at(1024);w=np.array(Image.open(ROOT/'references/z0/surface_water.png'))>0
    log['water_depth_percentiles_m_below_navd88']=np.percentile(d[w],[0,5,25,50,75,95,100]).tolist()
    log['zero_or_above_datum_fraction_on_tiger_water']=float(np.mean(d[w]==0))
    p.write_text(json.dumps(log,indent=2))
    prior=ROOT/'raw/round3/prior'
    for z in range(4):
        kept=ROOT/f'paintings/z{z}/retained-paint.png'
        if not kept.exists():kept.write_bytes((prior/f'z{z}-final-master.png').read_bytes())
    im=np.array(Image.open(ROOT/'paintings/z0/retained-paint.png'))
    im[w]=np.uint8(pigment(1024)[w]);Image.fromarray(im).save(ROOT/'reports/round3/depth-guide.png')
    print(json.dumps(log,indent=2))

if __name__=='__main__':main()
