"""Freeze fictional world changes independently of surveyed source geometry."""
import math,json
import numpy as np
from PIL import Image
from shapely.geometry import Polygon,Point,mapping,LineString
from shapely.ops import unary_union
from common import *

def main():
    roads=vectors('roads');water=unary_union([g for g,p in vectors('areawater')])
    gaps=[]
    for name,length,width in [('Julia Tuttle Cswy',38,40),('Venetian Way',26,20),('Mac Arthur Cswy',48,80),('Rickenbacker Cswy',40,30)]:
        choices=[]
        for g,p in roads:
            if p['name']!=name:continue
            wet=g.intersection(water)
            parts=list(wet.geoms) if hasattr(wet,'geoms') else [wet]
            choices.extend([h for h in parts if h.geom_type=='LineString'])
        line=max(choices,key=lambda h:h.length);s=line.length*.53
        c=line.interpolate(s);p1=line.interpolate(s-1);p2=line.interpolate(s+1)
        dx=p2.x-p1.x;dy=p2.y-p1.y;norm=math.hypot(dx,dy);dx/=norm;dy/=norm
        poly=Polygon([(c.x+u*dx+v*(-dy),c.y+u*dy+v*dx) for u,v in [(-length/2,-width/2),(length/2,-width/2),(length/2,width/2),(-length/2,width/2)]])
        gaps.append((poly.intersection(water),{'kind':'missing_bridge_span','causeway':name,'length_m':length,'authored':True}))
    wrecks=[]
    for i,(x,y,length,width,angle) in enumerate([(-550,-1850,62,12,-22),(650,-1900,40,9,16),(1900,-1300,31,8,-30),(-1400,-550,28,7,-15)]):
        theta=math.radians(angle);dx=math.cos(theta);dy=math.sin(theta)
        poly=Polygon([(x+u*dx-v*dy,y+u*dy+v*dx) for u,v in [(-length/2,-width/2),(length*.35,-width/2),(length/2,0),(length*.35,width/2),(-length/2,width/2)]])
        if not water.contains(poly):raise ValueError('Wreck placed on land')
        wrecks.append((poly,{'kind':'submerged_wreck','id':i,'authored':True,'length_m':length,'width_m':width,'angle_degrees':angle,'center':[x,y]}))
    features=[{'type':'Feature','geometry':mapping(g),'properties':p} for g,p in gaps+wrecks]
    (ROOT/'base/future_changes.geojson').write_text(json.dumps({'type':'FeatureCollection','crs':{'type':'name','properties':{'name':CFG['crs_proj']}},'features':features},indent=2))
    save(burn([(g,1) for g,p in gaps],N,GRID),ROOT/'base/bridge_gaps.png')
    save(burn([(g,1) for g,p in wrecks],N,GRID),ROOT/'base/wrecks.png')
    rd=np.array(Image.open(ROOT/'base/roads.png'))
    tunnels=[(g.buffer(p['width_m']/2,cap_style=2),1) for g,p in roads if 'tunl' in (p['name'] or '').lower()]
    tunnel=burn(tunnels,N,GRID)>0
    rd[tunnel]=4
    gap=np.array(Image.open(ROOT/'base/bridge_gaps.png'))>0
    rd[gap&(rd==3)]=5
    save(rd,ROOT/'base/roads.png')
    print('Frozen 4 missing spans, 4 submerged wrecks and tunnel visibility.')

if __name__=='__main__':main()
