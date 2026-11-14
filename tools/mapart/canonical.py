"""Preserve sub-cell geometry and repair clipped-polygon endpoint samples."""
import shutil,json
import numpy as np
from PIL import Image
from common import *

def main():
    n=8192
    for name in ['water','buildings']:
        shutil.copyfile(ROOT/f'references/z3/{name}.png',ROOT/f'base/{name}_fine.png')
    roads=vectors('roads');changes=vectors('future_changes')
    gaps=[(g,1) for g,p in changes if p['kind']=='missing_bridge_span']
    surface=[(g.buffer(p['width_m']/2,cap_style=2,join_style=2),2 if p['mtfcc'] in ['S1100','S1200'] else 1)
             for g,p in sorted(roads,key=lambda gp:gp[1]['width_m']) if 'tunl' not in (p['name'] or '').lower()]
    tunnels=[(g.buffer(p['width_m']/2,cap_style=2,join_style=2),1) for g,p in roads if 'tunl' in (p['name'] or '').lower()]
    changes_count={}
    # Preserve visible road intersections above tunnels, which are a separate layer.
    for size,tx,suffix in [(n,transform(n),'_fine'),(N,GRID,'')]:
        water=np.asarray(Image.open(ROOT/f'base/water{suffix}.png'))>0
        r=burn(surface,size,tx)
        r[(r>0)&water]=3
        tunnel=burn(tunnels,size,tx)>0
        r[tunnel&(r==0)]=4
        gap=burn(gaps,size,tx)>0
        r[gap&(r==3)]=5
        path=ROOT/f'base/roads{suffix}.png'
        if path.exists():changes_count[f'roads{suffix}_changes']=int((r!=np.asarray(Image.open(path))).sum())
        save(r,path)
    # Clipped polygon boundaries pass exactly through endpoint samples. GDAL's
    # half-open raster convention can classify those as outside. Use the adjacent
    # finest pixel inside the square for only the four outer sample lines.
    ix=np.minimum((np.arange(N,dtype=np.float64)*n/(N-1)).astype(int),n-1)
    for name in ['water','buildings','roads']:
        a=np.asarray(Image.open(ROOT/f'base/{name}.png')).copy()
        original=a.copy();fine=np.asarray(Image.open(ROOT/f'base/{name}_fine.png'))
        a[0]=fine[0,ix];a[-1]=fine[-1,ix];a[:,0]=fine[ix,0];a[:,-1]=fine[ix,-1]
        save(a,ROOT/f'base/{name}.png')
        changes_count[f'{name}_endpoint_corrections']=int((a!=original).sum())
    (ROOT/'checks/canonical_layers.json').write_text(json.dumps(changes_count,indent=2))
    print(changes_count,flush=True)

if __name__=='__main__':main()
