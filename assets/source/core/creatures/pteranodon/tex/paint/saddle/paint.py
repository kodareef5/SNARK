"""Paint the pinned saddle from its accepted study, without Blender.

Run from any directory. All writes are below this script, except the explicitly
requested regeneration of missing study deliverables by that study's builder.
The current piece/position/texel bakes and study PNGs are reopened on every run.
"""
from pathlib import Path
import ast
import base64
import hashlib
import json
import math
import os
import subprocess
import sys
import time
import types
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter, map_coordinates, distance_transform_edt

HERE = Path(__file__).resolve().parent
ASSET = HERE.parents[2]
PAINT = HERE.parent
STUDY = ASSET / 'tex/studies/saddle'
BAKES = ASSET / 'ref/bakes'
MAT = 'pteranodon_saddle'
F = np.float32
HEIGHT_MM = 4.0


def geometry():
    """Evaluate only the modeller's pure numerical construction, never Blender.

    Using the current mesh constructors supplies the actual rim and tube paths;
    the pinned corner UVs supply interpolation, not a second hand-drawn layout.
    All Blender imports, assembly, skinning and top-level builds are excluded.
    """
    def extract(path, allowed, env):
        tree = ast.parse(path.read_text())
        nodes = [n for n in tree.body if allowed(n)]
        exec(compile(ast.Module(body=nodes, type_ignores=[]), str(path), 'exec'), env)
        return types.SimpleNamespace(**env)
    rig = extract(ASSET/'rig.py', lambda n: isinstance(n, ast.FunctionDef) and n.name == '_catmull', {})
    env = dict(np=np, math=math, os=os, rig=rig, __file__=str(ASSET/'model.py'))
    numeric_functions = {'smin','smax','ellipsoid','mirror_x','sweep_rows','sweep_field',
                         'gape_y','mouth_cut','head_field','shell_field','gradient',
                         'cast','outward','_neck_frame','tube','_face','pillow',
                         'frame_along','rings_along','face_outward','split'}
    model = extract(ASSET/'model.py', lambda n:
        (isinstance(n, ast.Assign) and n.lineno < 300) or
        (isinstance(n, ast.FunctionDef) and n.name in numeric_functions) or
        (isinstance(n, ast.ClassDef) and n.name == 'Part'), env)
    env = dict(np=np, math=math, model=model, rig=rig)
    saddle = extract(ASSET/'saddle.py', lambda n:
        (isinstance(n, ast.Assign) and n.lineno < 420 and not any(isinstance(t, ast.Name) and t.id == 'TRIANGLES' for t in n.targets)) or
        (isinstance(n, ast.FunctionDef) and n.name not in ('build','skin_weights')) or
        (isinstance(n, ast.ClassDef) and n.name == 'Part'), env)
    parts = [saddle.seat_part(), *saddle.cantle_part(), saddle.girth_part(), saddle.collar_part(),
             saddle.grip_part('l'), saddle.strap_part('l',True), saddle.strap_part('l',False),
             saddle.boss_part(), *saddle.rest_part('l'), saddle.rein_part('l'),
             saddle.head_ring('halter_beak',saddle.HALTER['beak'],.002,saddle.HALTER['rope']),
             saddle.head_ring('halter_head',saddle.HALTER['head'],.002,saddle.HALTER['rope'])]
    pinned = json.loads((ASSET/'saddle_layout.json').read_text())['parts']
    for part in parts:
        if part.name in ('seat','cantle','cantle_plate','girth','collar','boss','halter_beak','halter_head'):
            saddle.symmetrize(part)
        model.face_outward(part)
        seen=set()
        part.triangles={i:model.split(part,f,seen) for i,f in enumerate(part.faces)}
        record = pinned[part.name]
        shape = hashlib.sha1(repr(part.faces).encode()).hexdigest()[:16]
        if shape != record['shape']:
            raise ValueError(f'{part.name}: topology no longer matches the pinned layout')
        uv = np.frombuffer(base64.b64decode(record['uv']), '<f4').reshape(-1,2)
        at = 0
        part.pinned = {}
        for face, piece in zip(record['face'], record['piece']):
            count = len(part.faces[face])
            part.pinned[face] = (record['pieces'][piece], uv[at:at+count].astype(F))
            at += count
        if at != len(uv):
            raise ValueError(f'{part.name}: pinned topology changed; rebuild bakes before painting')
    return {p.name:p for p in parts}, saddle


def length(line):
    return np.r_[0, np.cumsum(np.linalg.norm(np.diff(line,axis=0),axis=1))]*1000


def boundary(part, island, half=True):
    """Ordered physical perimeter, excluding the mirror cut down the middle."""
    edges = {}
    for f, name in zip(part.faces,part.islands):
        if name != island:
            continue
        for a,b in zip(f, f[1:]+f[:1]):
            key=tuple(sorted((a,b)))
            edges[key]=edges.get(key,0)+1
    pts=np.array(part.points)
    adj={}
    for (a,b), count in edges.items():
        if count!=1: continue
        if half and (min(pts[a,0],pts[b,0]) < -1e-5 or max(abs(pts[a,0]),abs(pts[b,0])) < 1e-5): continue
        adj.setdefault(a,[]).append(b); adj.setdefault(b,[]).append(a)
    ends=[k for k,v in adj.items() if len(v)==1]
    start=max(ends or list(adj),key=lambda k:(pts[k,2],pts[k,1]))
    chain=[start]; prev=None; at=start
    while True:
        nxt=[i for i in adj[at] if i!=prev]
        if not nxt: break
        n=nxt[0]; chain.append(n)
        if n==start: break
        prev,at=at,n
    return pts[chain]


def nearest_line(p,line):
    """Physical distance and continuous arc coordinate on a polyline (mm)."""
    p=np.array(p,dtype=F,copy=True); p[:,0]=abs(p[:,0])
    a=line[:-1]; ab=np.diff(line,axis=0); l2=(ab*ab).sum(-1)
    arcs=length(line)
    best=np.full(len(p),np.inf,F); along=np.zeros(len(p),F); across=np.zeros(len(p),F)
    for i,(q,d) in enumerate(zip(a,ab)):
        t=np.clip(((p-q)*d).sum(-1)/max(l2[i],1e-12),0,1)
        dist=((p-q-t[:,None]*d)**2).sum(-1)
        take=dist<best
        best[take]=dist[take]
        along[take]=arcs[i]+t[take]*(arcs[i+1]-arcs[i])
    return np.sqrt(best)*1000,along


def raster(part, values, size):
    """Interpolate corner attributes through the pinned polygons."""
    channels=len(next(iter(values.values()))[0])
    out=np.zeros((size,size,channels),F); cover=np.zeros((size,size),bool)
    for fi,(_,uv0) in part.pinned.items():
        if fi not in values: continue
        uv=uv0*np.array([size,-size])+[0,size]
        val=np.asarray(values[fi],F)
        for tri in part.triangles[fi]:
            tri=list(tri); p=uv[tri]; q=val[tri]
            x0,y0=np.maximum(np.floor(p.min(0)).astype(int),0)
            x1,y1=np.minimum(np.ceil(p.max(0)).astype(int),size-1)
            if x1<x0 or y1<y0:continue
            yy,xx=np.mgrid[y0:y1+1,x0:x1+1]; xs=xx+.5;ys=yy+.5
            den=(p[1,1]-p[2,1])*(p[0,0]-p[2,0])+(p[2,0]-p[1,0])*(p[0,1]-p[2,1])
            if abs(den)<1e-12:continue
            w0=((p[1,1]-p[2,1])*(xs-p[2,0])+(p[2,0]-p[1,0])*(ys-p[2,1]))/den
            w1=((p[2,1]-p[0,1])*(xs-p[2,0])+(p[0,0]-p[2,0])*(ys-p[2,1]))/den
            w2=1-w0-w1
            ok=(w0>=-1e-6)&(w1>=-1e-6)&(w2>=-1e-6)
            y,x=yy[ok],xx[ok]
            out[y,x]=w0[ok,None]*q[0]+w1[ok,None]*q[1]+w2[ok,None]*q[2]
            cover[y,x]=True
    return out,cover


def tube_values(part, around, rows, offset=0, closed=False):
    """Arc length + unwrapped circumference, including caps and the UV cut."""
    pts=np.array(part.points)[offset:offset+around*rows].reshape(rows,around,3)
    centres=pts.mean(1); arc=length(centres)
    full=arc[-1]+(np.linalg.norm(centres[-1]-centres[0])*1000 if closed else 0)
    values={}
    for fi,face in enumerate(part.faces):
        ids=np.asarray(face)-offset
        if np.any(ids<0) or np.any(ids>=around*rows+(0 if closed else 2)):continue
        rings=np.minimum(ids//around,rows-1)
        theta=(ids%around)/around
        body=ids<rows*around
        if np.ptp(theta[body])>.5:theta=np.where(theta<.5,theta+1,theta)
        s=arc[rings].copy()
        if closed and np.ptp(rings)>rows/2:s=np.where(rings==0,full,s)
        for j,idx in enumerate(ids):
            if idx>=rows*around:
                s[j]=0 if idx==rows*around else full
                theta[j]=np.mean(theta[body])
        # cap marker distinguishes an actual cut end of wood from its grain.
        cap=float(not body.all())
        values[fi]=np.stack([s,theta,np.full(len(face),full),np.full(len(face),cap)],-1)
    return values


def seat_edge_values(part, rim):
    """Keep the 7 mm inset even where the rear pad is substantially thicker.

    The rim has paired quads (top to rolled middle, middle to under). Distances
    are measured on those segments, so an oversized rear section never stretches
    a stitch into a radial spoke. The same arc phase follows both quads.
    """
    pts=np.array(part.points)
    faces=[i for i,n in enumerate(part.islands) if n=='seat_edge']
    result={}
    for top,under in zip(faces[::2],faces[1::2]):
        a,m,n,b=part.faces[top]
        _,ua,ub,_=part.faces[under]
        _,s=nearest_line(pts[[a,b]],rim)
        da=np.linalg.norm(pts[m]-pts[a])*1000
        db=np.linalg.norm(pts[n]-pts[b])*1000
        ta=da+np.linalg.norm(pts[ua]-pts[m])*1000
        tb=db+np.linalg.norm(pts[ub]-pts[n])*1000
        result[top]=[[s[0],0,ta],[s[0],da,ta],[s[1],db,tb],[s[1],0,tb]]
        result[under]=[[s[0],da,ta],[s[0],ta,ta],[s[1],tb,tb],[s[1],db,tb]]
    return result


class Study:
    def __init__(self):
        sets=['hide','hide_edge','wood','chitin','rope_plait','rope_twist','rope_wrap']
        required=[STUDY/f'{s}_{layer}.png' for s in sets for layer in ('base','height','packed')]
        if not (STUDY/'study.json').exists() or not all(p.exists() for p in required):
            subprocess.run([sys.executable,str(STUDY/'build.py')],check=True)
        self.meta=json.loads((STUDY/'study.json').read_text())['sets']
        self.active=None; self.raw=None; self.cache={}
        self.hashes={str(path.relative_to(ASSET)):hashlib.sha256(path.read_bytes()).hexdigest() for path in required}

    def load(self,name):
        # Retain only one 2048-square material at a time. The study remains the
        # source of truth; no copies of its maps are checked in beside the paint.
        self.cache.clear(); self.raw=None
        base=np.asarray(Image.open(STUDY/f'{name}_base.png'),dtype=F)
        h=np.asarray(Image.open(STUDY/f'{name}_height.png'),dtype=F)
        packed=np.asarray(Image.open(STUDY/f'{name}_packed.png'),dtype=F)
        h=(h/65535-.5)*self.meta[name]['height_mm']
        self.raw=np.concatenate([base,h[...,None],packed[...,1:2]/255,packed[...,0:1]/255],-1)
        self.active=name

    def sample(self,name,u,v,footprint=1.0):
        """u,v are physical mm in the delivered study; low-pass before reduction."""
        if self.active!=name:self.load(name)
        span=self.meta[name]['span_m']*1000
        # Quantize filtering only, never the physical coordinates or feature size.
        sigma=round(max(.0,float(footprint)*2048/span*.38)*2)/2
        key=(name,sigma)
        if key not in self.cache:
            self.cache.clear()
            a=self.raw
            self.cache[key]=gaussian_filter(a,(sigma,sigma,0),mode='wrap') if sigma>.1 else a
        src=self.cache[key]
        coords=[np.asarray(v)%span/span*src.shape[0],np.asarray(u)%span/span*src.shape[1]]
        return np.stack([map_coordinates(src[...,c],coords,order=1,mode='grid-wrap') for c in range(6)],-1)

    def wood_cylinder(self,s,theta,radius,footprint):
        """Close a physical-width strip of wood, preserving fine grain scale.

        A 400 mm swatch must not be squeezed into a 100/126 mm circumference.
        Crop that actual width, remove only its wrap mismatch, then filter it.
        The same correction is applied to all aligned material channels.
        """
        if self.active!='wood':self.load('wood')
        span=self.meta['wood']['span_m']*1000
        girth=2*np.pi*radius*1000
        rows=round(girth/span*self.raw.shape[0])
        sigma=round(footprint*2048/span*.38*2)/2
        key=('wood_cylinder',radius,sigma)
        if key not in self.cache:
            self.cache.clear()
            yy=(80+np.arange(rows,dtype=F)/rows*girth)/span*self.raw.shape[0]
            iy=np.floor(yy).astype(int);frac=(yy-iy)[:,None,None]
            a=(self.raw[iy]*(1-frac)+self.raw[(iy+1)%self.raw.shape[0]]*frac).astype(F)
            a-=np.linspace(-.5,.5,rows,dtype=F)[:,None,None]*(a[-1]-a[0])[None]
            self.cache[key]=gaussian_filter(a,(sigma,sigma,0),mode='wrap')
        a=self.cache[key]
        coords=[(theta%1)*rows,(s%span)/span*a.shape[1]]
        return np.stack([map_coordinates(a[...,c],coords,order=1,mode='grid-wrap') for c in range(6)],-1)


def blend(a,b,w):
    w=np.clip(w,0,1)
    return a*(1-w[:,None])+b*w[:,None]


def smooth(a,b,x):
    t=np.clip((x-a)/(b-a),0,1)
    return t*t*(3-2*t)


def main():
    start=time.monotonic()
    for folder in ('layers','checks'):(HERE/folder).mkdir(exist_ok=True)
    info=json.loads((PAINT/f'{MAT}_pieces.json').read_text())
    size=info['size']; assert size==1024
    ids=np.asarray(Image.open(PAINT/f'{MAT}_pieces.png'))[...,0]
    mm=np.asarray(Image.open(PAINT/f'{MAT}_texel_mm.png'),dtype=F)/1000
    lo=np.array(info['position_box']['min'],F); hi=np.array(info['position_box']['max'],F)
    pos=np.stack([np.asarray(Image.open(PAINT/f'{MAT}_position_{a}.png'),dtype=F)/65535 for a in 'xyz'],-1)*(hi-lo)+lo
    pos[...,0]=abs(pos[...,0])
    normal=np.asarray(Image.open(BAKES/f'{MAT}_normal_object.png').convert('RGB'),dtype=F)/127.5-1
    curve=np.asarray(Image.open(BAKES/f'{MAT}_curvature.png').convert('L'),dtype=F)/255
    study=Study(); parts,saddle=geometry()
    number={p['name']:p['number'] for p in info['pieces']}
    output=np.zeros((size,size,6),F);output[...,4:]=1
    metrics={};coord_misses={}

    def coords(partname,values,mask):
        a,ok=raster(parts[partname],values,size)
        valid=ok&mask
        missing=mask&~ok
        if missing.any():
            if not valid.any():raise ValueError(f'no mapping for {partname}')
            _,idx=distance_transform_edt(~valid,return_indices=True)
            a[missing]=a[idx[0][missing],idx[1][missing]]
        coord_misses[partname]=coord_misses.get(partname,0)+int(missing.sum())
        return a[mask]

    def tube(name,partname,around,rows,kind,radius,offset=0,closed=False,submask=None):
        mask=ids==number[name]
        if submask is not None:mask&=submask
        values=tube_values(parts[partname],around,rows,offset,closed)
        # Restrict multi-island pieces (halter and twin rest ropes) to this chart.
        chart,coverage=raster(parts[partname],values,size)
        if submask is None and (name in ('rope','halter')):mask &= coverage
        s,t,total,cap=coords(partname,values,mask).T
        footprint=float(np.median(mm[mask]))
        if kind in ('rope_plait','rope_twist'):
            nominal=12 if kind=='rope_plait' else 6
            scale=radius*2000/nominal
            # A closed head loop gets a whole number of the 3-strand lay pitch.
            if closed:
                pitch=18.85*scale
                s=s/total*np.maximum(np.round(total/pitch),1)*pitch
            data=study.sample(kind,s/scale,t*(37.7 if kind=='rope_plait' else 18.85),footprint/scale)
            data[:,3]*=scale
        else:
            # Longitudinal fibres at their original size around the full rod.
            wood=study.wood_cylinder(s,t,radius,footprint)
            polish=(.5+.5*np.cos(2*np.pi*t))*(1-cap)
            wood[:,4]-=.055*polish
            data=wood
            if kind=='rope_wrap':
                rope=study.sample('rope_wrap',s,t*100,footprint)
                # Short bare feet; the continuous spiral passes once round the
                # 32 mm loop per study circumference, advancing by 4 mm.
                wrapping=smooth(16,21,s)*(1-smooth(total-23,total-18,s))
                rope[:,4]-=.065*np.exp(-((s-total*.52)/75)**2)
                data=blend(wood,rope,wrapping)
            elif name=='peg':
                # The end grain is sampled from the accepted wood, with a small
                # physical concentric growth modulation confined to cap faces.
                p=pos[mask];rr=np.sqrt((p[:,1]-.430)**2+(p[:,2]-.320)**2)*1000
                rings=np.sin(rr*2*np.pi/2.8+.35*np.sin(rr))
                data[:,:3]+=cap[:,None]*rings[:,None]*np.array([4,3.2,2.0])
                data[:,3]+=cap*.018*rings
                data[:,4]-=.065*np.exp(-((s-50)/25)**2)*(1-cap)
        output[mask]=data

    tube('cantle','cantle',8,13,'wood',.020)
    tube('grip','grip_l',6,11,'rope_wrap',.016)
    tube('peg','peg_l',8,3,'wood',.016)
    tube('rein','rein_l',5,11,'rope_plait',.006)
    tube('rope','rest_l',5,7,'rope_plait',.0065,offset=0)
    tube('rope','rest_l',5,7,'rope_plait',.0065,offset=37)
    tube('halter','halter_beak',4,12,'rope_twist',.0055,closed=True)
    tube('halter','halter_head',4,12,'rope_twist',.0055,closed=True)

    # The full seat perimeter is shared by its face, rolled edge and underside.
    seat_rim=boundary(parts['seat'],'seat_top')
    # Band boundary curves are two rings at the real front/back cut edges.
    band_lines={}
    for name in ('girth','collar'):
        p=np.array(parts[name].points);k=20 if name=='girth' else 16
        for side,indices in enumerate((range(0,k),range(k,2*k))):
            line=p[list(indices)][:k//2+1]
            band_lines[name,side]=line

    for item in info['pieces']:
        name=item['name'];mask=ids==item['number'];p=pos[mask];step=float(np.median(mm[mask]))
        x,y,z=p.T
        if name.startswith('seat'):
            # Flatten the pad round its torso section without losing its true
            # width; x=0 remains a symmetric, continuous material field.
            side_arc=np.arctan2(x,np.maximum(y-.745,.025))*185
            data=study.sample('hide',z*1000+270,side_arc+110,step)
            d,s=nearest_line(p,seat_rim)
            if name=='seat_edge':
                s,depth,total=coords('seat',seat_edge_values(parts['seat'],seat_rim),mask).T
                t=depth/np.maximum(total,1e-6)
                data=study.sample('hide_edge',s,7+depth,step)
                data[:,5]*=1-.18*smooth(.4,1,t)
            else:
                edge=study.sample('hide_edge',s,7+d,step)
                data=blend(data,edge,1-smooth(13,22,d))
                if name=='seat_top':
                    hip=np.exp(-((x/.115)**2+((z+.205)/.155)**2))
                    front=np.exp(-(((x-.105)/.055)**2+((z-.008)/.075)**2))
                    knee=np.exp(-(((x-.150)/.045)**2+((z+.055)/.110)**2))
                    wear=np.clip(.90*hip+.55*front+.45*knee,0,1)*(smooth(9,24,d))
                    # Curvature is only a placement hint for polishing the dish.
                    wear=np.clip(wear*(1+.12*(.5-curve[mask])),0,1)
                    data[:,:3]*=(1-.22*wear[:,None])
                    data[:,3]*=1-.5*wear
                    data[:,4]-=.14*wear
                    data[:,5]*=1-.09*np.exp(-d/7)
                else:
                    data[:,5]*=.70+.12*smooth(0,30,d)
                    data[:,4]+=.055
            # Small pale abraded nicks, confined to the physical rim.
            scuff=np.exp(-d/3.5)*(.5+.5*np.sin(s/3.7)*np.sin(s/13.1))
            data[:,:3]+=scuff[:,None]*np.array([8,6,3.5])
            output[mask]=data
        elif name.startswith(('girth','collar')):
            band=name.split('_')[0]
            d0,s0=nearest_line(p,band_lines[band,0]);d1,s1=nearest_line(p,band_lines[band,1])
            which=d1<d0;d=np.minimum(d0,d1);s=np.where(which,s1,s0)
            across=d0
            data=study.sample('hide',s,90+across,step)
            if 'edge' in name:
                # The 5 mm cut edge needs its sewing channel moved to the
                # middle: preserve thread width/length rather than squeezing
                # the study's 14 mm inset into a fraction of a texel.
                # Body-facing edge depth is measured against outer ring, not UV.
                out_line=band_lines[band,0 if name.endswith('2') else 1]
                dep,arc=nearest_line(p,out_line)
                t=np.clip(dep/5,0,1)
                data=study.sample('hide_edge',arc,7+dep,step)
                sewing=study.sample('hide_edge',arc,14+dep-2.5,step)
                data=blend(data,sewing,1-smooth(.85,1.7,np.abs(dep-2.5)))
                data[:,5]*=1-.20*t
            else:
                edge=study.sample('hide_edge',s,7+d,step)
                data=blend(data,edge,1-smooth(11,18,d))
                if name.endswith('_in'):
                    data[:,5]*=.69+.11*smooth(0,15,d)
                    data[:,4]+=.06
                else:
                    data[:,5]*=1-.10*np.exp(-d/5)
                    rub=np.exp(-((y-.89)/.10)**2)*smooth(8,15,d)
                    data[:,:3]*=1-.07*rub[:,None]
                    data[:,4]-=.06*rub
            output[mask]=data
        elif name.startswith('strap'):
            # The upper and lower breast straps have separate pinned charts.
            for pn in ('strap_upper_l','strap_lower_l'):
                part=parts[pn]; values={fi:np.array(part.points)[list(part.faces[fi])] for fi in part.pinned if part.pinned[fi][0]==name}
                _,cv=raster(part,values,size);take=mask&cv
                if not take.any():continue
                q=pos[take]
                rim=boundary(part,'strap_out')
                d,s=nearest_line(q,rim)
                data=study.sample('hide',q[:,1]*1000,q[:,0]*1000+45,step)
                data=blend(data,study.sample('hide_edge',s,7+d,step),1-smooth(10,17,d))
                if name.endswith('_in'):data[:,5]*=.76
                else:data[:,5]*=1-.07*np.exp(-d/5)
                output[take]=data
        elif name.startswith('cantle_plate'):
            part=parts['cantle_plate']; points=np.array(part.points)
            # Outer grid: 13 rows along the bow, 3 vertices down the plate.
            grid=points[:39].reshape(13,3,3); arc=length(grid[:,0]);depth=np.linalg.norm(grid[:,2]-grid[:,0],axis=1)*1000
            attributes={}
            for fi in part.pinned:
                if part.pinned[fi][0]!=name:continue
                q=points[list(part.faces[fi])]
                # Nearest outer vertex also identifies the shared rim of the
                # inner pillow; row and depth agree across both plate islands.
                idx=np.argmin(((q[:,None]-points[None,:39])**2).sum(-1),axis=1)
                rr=idx//3;cc=idx%3
                attributes[fi]=np.stack([arc[rr],cc/2*depth[rr],depth[rr]],-1)
            s,dep,width=coords('cantle_plate',attributes,mask).T
            # Growth layers track the bent upper and lower edges of the plate.
            edge=np.minimum(dep,width-dep)
            data=study.sample('chitin',s,8+edge,step)
            data[:,:3]-=np.exp(-edge[:,None]/2.8)*np.array([10,11,13])
            data[:,4]-=.025*np.exp(-edge/3)
            if name.endswith('_in'):data[:,5]*=.95
            output[mask]=data
        elif name=='boss':
            part=parts['boss'];pts=np.array(part.points);centre=pts[:16].mean(0)
            n=pts[16:32].mean(0)-centre;n/=np.linalg.norm(n)
            q=p-centre;q-=np.sum(q*n,axis=1)[:,None]*n
            radius=np.linalg.norm(q,axis=1)*1000
            data=study.sample('chitin',p[:,0]*1000+95,8+np.maximum(0,30-radius),step)
            data[:,:3]-=np.exp(-(30-radius)[:,None]/3)*np.array([8,9,10])
            output[mask]=data
        elif name not in ('cantle','grip','peg','rein','rope','halter'):
            raise ValueError(f'Unhandled piece {name}')

    owned=ids>0
    # Fill only tiny rebake shifts from the nearest currently painted texel of
    # the SAME piece. All material channels share the identical support.
    for item in info['pieces']:
        mask=ids==item['number'];missing=mask&(output[...,:3].sum(-1)==0)
        if missing.any():
            valid=mask&~missing
            if not valid.any():raise ValueError(f'{item["name"]}: entirely unpainted')
            _,ind=distance_transform_edt(~valid,return_indices=True)
            output[missing]=output[ind[0][missing],ind[1][missing]]
            coord_misses[item['name']]=int(missing.sum())
        data=output[mask]
        metrics[item['name']]=dict(texels=int(mask.sum()),mean_srgb=np.round(data[:,:3].mean(0,dtype=np.float64),2).tolist(),
            mean_roughness=round(float(data[:,4].mean()),4),mean_occlusion=round(float(data[:,5].mean()),4),
            height_range_mm=np.round([data[:,3].min(),data[:,3].max()],4).tolist())
    if np.max(abs(output[...,3][owned]))>=HEIGHT_MM/2:raise ValueError('height encoding overflow')
    def save(name,a):Image.fromarray(a).save(HERE/'layers'/f'{MAT}_{name}.png')
    base=np.uint8(np.clip(np.rint(output[...,:3]),0,255))
    save('base',np.dstack([base,np.uint8(owned)*255]))
    save('height',np.uint16(np.clip(np.rint((output[...,3]/HEIGHT_MM+.5)*65535),0,65535)))
    save('rough',np.uint8(np.clip(np.rint(output[...,4]*255),0,255)))
    save('occlusion',np.uint8(np.clip(np.rint(output[...,5]*255),0,255)))
    save('regions',np.zeros((size,size,3),np.uint8))
    (HERE/'layers/layers.json').write_text(json.dumps({f'{MAT}_height_mm':HEIGHT_MM},indent=2)+'\n')
    report=dict(size=size,covered_texels=int(owned.sum()),pieces=metrics,coordinate_fallback_texels=coord_misses,study_sha256=study.hashes)
    (HERE/'checks/metrics.json').write_text(json.dumps(report,indent=2)+'\n')
    print(f'Painted all {len(metrics)} pieces, {owned.sum()} texels, 1024 square in {time.monotonic()-start:.1f}s',flush=True)
    print('Coordinate fallbacks:',{k:v for k,v in coord_misses.items() if v})

if __name__=='__main__':main()
