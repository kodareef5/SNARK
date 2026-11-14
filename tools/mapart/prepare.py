"""Build the registered geographic foundation; no inference is called surveyed data."""
import json
import math
import zipfile
import time
import shapefile
import numpy as np
import rasterio
from rasterio.warp import reproject,transform_bounds,Resampling
from rasterio.windows import Window,transform as win_transform
from shapely.geometry import shape,mapping,box,Polygon,MultiPolygon
from shapely.ops import transform as project,unary_union
from shapely import make_valid
from pyproj import Transformer
from scipy import ndimage as nd
from common import *

RAW=ROOT/'raw'; BASE=ROOT/'base'; CLIP=box(*B)
TO_MAP=Transformer.from_crs(4269,CRS,always_xy=True).transform
FROM_WGS=Transformer.from_crs(4326,CRS,always_xy=True).transform

def write_features(name,features):
    (BASE/f'{name}.geojson').write_text(json.dumps({'type':'FeatureCollection',
       'name':name,'crs':{'type':'name','properties':{'name':CFG['crs_proj']}},
       'features':[{'type':'Feature','geometry':mapping(g),'properties':p} for g,p in features]},separators=(',',':')))

def tiger(name):
    path=RAW/f'tl_2025_12086_{name}.zip'
    with zipfile.ZipFile(path) as z:z.extractall(RAW/'tiger')
    reader=shapefile.Reader(str(RAW/'tiger'/path.stem))
    fields=[f[0] for f in reader.fields[1:]]
    bbox=Transformer.from_crs(CRS,4269,always_xy=True).transform_bounds(*B)
    features=[]
    for sr in reader.iterShapeRecords(bbox=bbox):
        g=project(TO_MAP,make_valid(shape(sr.shape.__geo_interface__))).intersection(CLIP)
        if g.is_empty:continue
        p=dict(zip(fields,sr.record))
        if name=='roads':
            # These are cartographic/game corridor widths, NOT measured road edges.
            code=p['MTFCC'];width={'S1100':22,'S1200':14,'S1400':8,'S1630':7,'S1640':5,'S1710':3,'S1720':3,'S1740':4}.get(code,6)
            p={'id':str(p['LINEARID']),'mtfcc':code,'name':p.get('FULLNAME'),'width_m':width}
        else:p={'id':str(p['HYDROID']),'mtfcc':p['MTFCC'],'name':p.get('FULLNAME')}
        features.append((g,p))
    write_features(name,features)
    print(name,len(features),flush=True)
    return features

def buildings():
    features=[]; ids=[]
    for path in sorted((RAW/'fema').glob('page_*.json')):
        for f in json.loads(path.read_text())['features']:
            oid=f['attributes']['OBJECTID']; ids.append(oid)
            # Esri rings use clockwise shells and counterclockwise holes. Polygonize
            # through signed orientation, then subtract contained holes.
            rings=f['geometry']['rings']; shells=[]; holes=[]
            for ring in rings:
                p=Polygon(ring)
                (holes if p.exterior.is_ccw else shells).append(p)
            if not shells:shells=holes;holes=[]
            g=unary_union([make_valid(p) for p in shells])
            if holes:g=g.difference(unary_union([make_valid(p) for p in holes]))
            g=project(FROM_WGS,g).intersection(CLIP)
            if not g.is_empty:features.append((g,{'id':oid}))
    expected=json.loads((RAW/'fema/ids.json').read_text())['objectIds']
    assert set(ids)==set(expected) and len(ids)==len(set(ids)), 'Missing or duplicate buildings'
    write_features('buildings',features);print('buildings',len(features),flush=True)
    return features

def elevation():
    out=np.full((N,N),-9999,dtype=np.float32)
    for i,name in enumerate(json.loads((ROOT/'dem_selection.json').read_text())):
        with rasterio.open(RAW/'dem'/name) as src:
            b=transform_bounds(src.crs,CRS,*src.bounds,densify_pts=21)
            c0=max(0,math.floor((b[0]-GRID.c)/2)-2); c1=min(N,math.ceil((b[2]-GRID.c)/2)+2)
            r0=max(0,math.floor((GRID.f-b[3])/2)-2);r1=min(N,math.ceil((GRID.f-b[1])/2)+2)
            if c0>=c1 or r0>=r1:continue
            dst=np.full((r1-r0,c1-c0),-9999,dtype=np.float32)
            reproject(rasterio.band(src,1),dst,src_transform=src.transform,src_crs=src.crs,
                      src_nodata=src.nodata,dst_transform=win_transform(Window(c0,r0,c1-c0,r1-r0),GRID),
                      dst_crs=CRS,dst_nodata=-9999,resampling=Resampling.bilinear)
            good=dst!=-9999
            out[r0:r1,c0:c1][good]=dst[good]*(1200/3937) # NAVD88 US survey ft -> m
        if i%100==0:print('height',i,flush=True)
    return out

def main():
    t=time.time()
    water=tiger('areawater');roads=tiger('roads');bld=buildings()
    w=burn([(g,1) for g,p in water],N,GRID)
    b=burn([(g,1) for g,p in bld],N,GRID)
    rd=burn([(g.buffer(p['width_m']/2,cap_style=2,join_style=2),1 if p['mtfcc'] not in ['S1100','S1200'] else 2) for g,p in sorted(roads,key=lambda gp:gp[1]['width_m'])],N,GRID)
    # Bridges remain elevated over the source water; water still exists beneath.
    rd[(rd>0)&(w>0)]=3
    elev=elevation();valid=elev!=-9999
    # Retain explicit validity. Open water is not surveyed bathymetry. Fill only the
    # engine-ready height with a flat -1m convention where the DEM has no data.
    elev[~valid]=-1
    save(np.rint(np.clip((elev+100)*100,0,65535)).astype('uint16'),BASE/'height.png')
    save(valid.astype('uint8')*255,BASE/'height_valid.png')
    save(w,BASE/'water.png');save(b,BASE/'buildings.png');save(rd,BASE/'roads.png')
    lc=np.zeros((N,N),np.uint8)
    with rasterio.open(RAW/'nlcd2021.tif') as src:
        print('NLCD',src.count,src.dtypes,src.bounds,flush=True)
        reproject(rasterio.band(src,1),lc,src_transform=src.transform,src_crs=src.crs,
                  dst_transform=GRID,dst_crs=CRS,resampling=Resampling.nearest)
    save(lc,BASE/'landcover.png')
    # Fictional ecological succession is explicit and distinct from NLCD.
    coast=nd.distance_transform_edt(w==0)*2
    grown=np.isin(lc,[21,31,41,42,43,52,71,90,95]) | ((lc==22)&(coast<180))
    grown=nd.gaussian_filter(grown.astype('float32'),4)>.48
    # Authored reclamation in actual vacant strips around ruin footprints. The
    # slowly varying deterministic field picks coherent groves, not pixel noise.
    yy,xx=np.mgrid[:N,:N].astype(np.float32)
    field=np.sin(xx/47+.7*np.sin(yy/83))+np.cos(yy/61-xx/103)
    near_ruin=nd.distance_transform_edt(b==0)*2<18
    away_road=nd.distance_transform_edt(rd==0)*2>6
    grown |= near_ruin&away_road&(b==0)&(w==0)&(elev<6)&(field>-.25)
    biome=np.full((N,N),2,np.uint8) # pale abandoned urban/open land
    biome[grown]=3
    biome[grown&(coast<70)]=4
    biome[grown&(elev<.75)&(coast<140)]=5
    # Bare sand only where NLCD says bare, plus exposed coast of Miami Beach east
    # of its street grid; this second ribbon is an authored succession rule.
    xs=np.arange(N)*2+B[0]; ys=B[3]-np.arange(N)*2
    beach=(lc==31)|((xs[None,:]>3000)&(coast<90)&(elev<3.5))
    biome[beach]=6
    biome[b>0]=7;biome[rd>0]=8;biome[w>0]=1;biome[rd==3]=9
    save(biome,BASE/'biome.png')
    # Isolated low street pools, without changing the coast. Shared with future world.
    flooded=(w==0)&(rd>0)&(rd<3)&valid&(elev<.55)&(coast<300)&(b==0)
    flooded=nd.binary_opening(flooded,iterations=1)
    save(flooded.astype('uint8'),BASE/'flooded_streets.png')
    stats={'seconds':time.time()-t,'roads':len(roads),'water_polygons':len(water),'buildings':len(bld),
        'dem_valid_fraction':float(valid.mean()),'dem_missing_on_source_land_samples':int(((w==0)&~valid).sum()),
        'height_m_valid_min_max':[float(elev[valid].min()),float(elev[valid].max())],
        'water_fraction':float(w.mean()),'nlcd_values':list(map(int,np.unique(lc))),
        'flooded_street_samples':int(flooded.sum())}
    (BASE/'stats.json').write_text(json.dumps(stats,indent=2));print(stats,flush=True)

if __name__=='__main__':main()
