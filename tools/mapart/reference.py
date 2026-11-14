"""Render native-scale geographic references independently, never enlarge a mask."""
import argparse,json
import numpy as np
from PIL import Image
from scipy import ndimage as nd
from rasterio.warp import reproject,Resampling
from common import *

PALETTE=np.array([[0,0,0],[86,133,128],[211,207,173],[156,165,119],
                 [123,134,96],[155,163,133],[231,212,162],[177,164,138],
                 [220,208,170],[220,208,170]],dtype=np.uint8)

def grid_at(name,n):
    a=np.array(Image.open(ROOT/'base'/f'{name}.png'))
    out=np.zeros((n,n),dtype=a.dtype)
    reproject(a,out,src_transform=GRID,src_crs=CRS,dst_transform=transform(n),
              dst_crs=CRS,resampling=Resampling.nearest)
    return out

def build(z):
    n=1024*2**z; ref=ROOT/'references'/f'z{z}';ref.mkdir(parents=True,exist_ok=True)
    water=vectors('areawater');roads=vectors('roads');buildings=vectors('buildings')
    w=burn([(g,1) for g,p in water],n)>0
    rd=burn([(g.buffer(p['width_m']/2,cap_style=2,join_style=2),
               2 if p['mtfcc'] in ['S1100','S1200'] else 1) for g,p in sorted(roads,key=lambda gp:gp[1]['width_m'])
               if 'tunl' not in (p['name'] or '').lower()],n)
    if (ROOT/'base/future_changes.geojson').exists():
        gaps=[(g,1) for g,p in vectors('future_changes') if p['kind']=='missing_bridge_span']
        rd[burn(gaps,n)>0]=0
    b=burn([(g,1) for g,p in buildings],n)>0
    bio=grid_at('biome',n);bio[(bio==7)|(bio==8)|(bio==9)]=2
    bio[w]=1;bio[rd>0]=8;bio[b]=7
    surface=w&(rd==0)&~b
    for name,a in [('water',w),('surface_water',surface),('roads',rd),('buildings',b),('biome',bio)]:
        save(a.astype('uint8'),ref/f'{name}.png')
    a=PALETTE[bio].copy()
    # Broad pale shallows belong on water, and have a fixed world width.
    d=nd.distance_transform_edt(w)
    shallow=(d<60/(SIZE/n))&surface
    a[shallow]=[163,198,181]
    edge=surface&~nd.binary_erosion(surface,border_value=1)
    a[edge]=[63,91,76]
    bedge=b&~nd.binary_erosion(b,border_value=1)
    a[bedge]=[92,82,61]
    # Subpixel roads still visible in the far-scale reference via their exact lines.
    centers=burn([(g,1) for g,p in roads if 'tunl' not in (p['name'] or '').lower()],n)>0
    if (ROOT/'base/future_changes.geojson').exists():centers[burn(gaps,n)>0]=False
    a[centers&~b]=[222,208,171]
    save(a,ref/'whole.png')
    im=Image.fromarray(a)
    for y in range(2**z):
        for x in range(2**z):
            im.crop((x*1024,y*1024,(x+1)*1024,(y+1)*1024)).save(ref/f'{x}_{y}.png')
    print('reference',z,n,flush=True)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('zooms',nargs='*',type=int,default=[0,1,2,3]);args=p.parse_args()
    for z in args.zooms:build(z)
