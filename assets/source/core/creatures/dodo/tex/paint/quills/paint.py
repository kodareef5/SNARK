"""Paint the shared tail and finger rectangles from the accepted quill masters.

python3 -I tex/paint/quills/paint.py
All writes are local to this group. No service call, Blender, or study mutation.
"""
import sys,site
sys.dont_write_bytecode=True
site.addsitedir(site.getusersitepackages())
from pathlib import Path
import json,hashlib
import numpy as np
from PIL import Image,PngImagePlugin
from scipy.ndimage import map_coordinates,distance_transform_edt,label

HERE=Path(__file__).resolve().parent
DODO=HERE.parents[2]
STUDY=DODO/'tex/studies/quills'
LAYERS=HERE/'layers'
SIZE=2048
HEIGHT_MM=1.4
CARDS={
    'tail':{'element':'tail_center','scale':1.,'width_scale':1.,'root_above_bottom_mm':.6},
    'finger':{'element':'wing_finger_1','scale':1.,'width_scale':1.,'root_above_bottom_mm':.6},
}


def decode(s):return np.where(s<=.04045,s/12.92,((s+.055)/1.055)**2.4)
def encode(v):
    v=np.clip(v,0,1)
    return np.where(v<=.0031308,v*12.92,1.055*v**(1/2.4)-.055)

def save(path,a,bits=8,srgb=False):
    info=PngImagePlugin.PngInfo();info.add(b'gAMA',(45455 if srgb else 100000).to_bytes(4,'big'))
    if srgb:info.add(b'sRGB',b'\x00')
    den=65535 if bits==16 else 255
    Image.fromarray(np.rint(np.clip(a,0,1)*den).astype(np.uint16 if bits==16 else np.uint8)).save(path,pnginfo=info)


def rectangle(uv):
    u0,v0,u1,v1=uv
    return [round(u0*SIZE),round((1-v1)*SIZE),round(u1*SIZE),round((1-v0)*SIZE)]


def surface_widths(kind,card_mm):
    """Dimensionless taper from the baked shape, scaled by today's card width.
    The snapshot supplies shape only; pieces.json owns absolute millimetres.
    """
    geom=json.loads((HERE/'source/cards_geometry.json').read_text())
    rows={};island='tail_out' if kind=='tail' else 'fingers_l_out'
    u0,v0,u1,v1=geom['atlas'][kind]
    for f in geom['faces']:
        if f['i']!=island:continue
        st=np.array(f['uv']);p=np.array(f['p'])
        for a in range(len(st)):
            for b in range(a+1,len(st)):
                if abs(st[a,1]-st[b,1])>1e-8 or abs(st[a,0]-st[b,0])<1e-8:continue
                t=round((st[a,1]-v0)/(v1-v0),6)
                width=np.linalg.norm(p[a]-p[b])/abs(st[a,0]-st[b,0])*(u1-u0)*1000
                rows.setdefault(t,[]).append(float(width))
    width_scale=card_mm[0]/geom['reference_card_mm'][kind][0]
    return [[t,float(np.median(rows[t]))*width_scale] for t in sorted(rows)]


def extend(a,mask):
    _,ix=distance_transform_edt(~mask,return_indices=True)
    return a[tuple(ix)]


def normal(height_mm,dx_mm,dy_mm):
    gy,gx=np.gradient(height_mm,dy_mm,dx_mm)
    n=np.stack([-gx,gy,np.ones_like(height_mm)],-1)
    return n/np.linalg.norm(n,axis=-1,keepdims=True)


def occlusion(height,dx,dy):
    result=np.zeros_like(height);ys,xs=np.indices(height.shape)
    for sx,sy in [(1,0),(-1,0),(0,1),(0,-1),(1,1),(-1,1),(1,-1),(-1,-1)]:
        horizon=np.zeros_like(height)
        for r in [1,2,4,8,16]:
            shifted=height[np.clip(ys+sy*r,0,height.shape[0]-1),np.clip(xs+sx*r,0,height.shape[1]-1)]
            horizon=np.maximum(horizon,(shifted-height)/(r*np.hypot(sx*dx,sy*dy)))
        result+=np.sin(np.arctan(np.maximum(horizon,0)))/8
    return np.clip(1-.75*result,.76,1.)


def calibrate(lum,alpha,reg,n,atlas_y):
    """Preserve intrinsic drawing; remove residual broad lighting at the new UV scale.
    Constant terms keep each region and occupied atlas quadrant at mean 0.50.
    """
    valid=alpha>=.5
    group=(reg//5)*2+(atlas_y>=SIZE//2).astype(int)
    nn=n[valid];rr=reg[valid];g=group[valid]
    cols=[nn[:,axis]*(rr==rid) for rid in np.unique(rr) for axis in range(3)]
    cols += [(g==k).astype(float) for k in np.unique(g)]
    A=np.stack(cols,axis=1);value=lum[valid]-.5
    fit=np.linalg.lstsq(A,value,rcond=None)[0]
    residual=value-np.einsum('ij,j->i',A,fit)
    assert np.isfinite(residual).all()
    out=lum.copy();out[valid]=np.clip(.5+residual,.12,.90)
    for k in np.unique(g):
        m=valid&(group==k);out[m]+=.5-out[m].mean()
    return extend(out,valid)


def paint():
    LAYERS.mkdir(exist_ok=True)
    study=json.loads((STUDY/'study.json').read_text())['sets']['quills']
    rects=json.loads((DODO/'ref/bakes/bakes.json').read_text())['material dodo_cards']['rectangles']
    pieces_path=DODO/'tex/paint/pieces.json'
    measured=json.loads(pieces_path.read_text())['cards']
    outputs={k:np.zeros((SIZE,SIZE),np.float32) for k in ['height','rough','occlusion']}
    outputs['base']=np.zeros((SIZE,SIZE,4),np.float32)
    outputs['regions']=np.zeros((SIZE,SIZE,3),np.float32)
    info={'height_mm':HEIGHT_MM,'cards_height_mm':HEIGHT_MM,'group':'quills','opaque_pieces':[],
          'alpha_cutoff':.5,'two_sided':True,'card_rectangles':{},'sources':{},
          'note':'Only tail and finger rectangles. Root down, tip up. UV width compensates the baked mesh taper; accepted study masters unchanged.'}
    geometry=HERE/'source/cards_geometry.json'
    info['sources'][str(geometry.relative_to(DODO))]=hashlib.sha256(geometry.read_bytes()).hexdigest()
    info['sources'][str(pieces_path.relative_to(DODO))]=hashlib.sha256(pieces_path.read_bytes()).hexdigest()
    for kind,settings in CARDS.items():
        card=measured[kind]
        assert np.allclose(card['rect'],rects[kind]),f'{kind}: measurement and bake layouts disagree'
        cfg={**settings,'card_mm':card['card_mm'],'mm_per_texel':card['mm_per_texel']}
        e=next(e for e in study['elements'] if e['id']==cfg['element'])
        folder=STUDY/e['source'];src={}
        for key,file in [('base','cutout.png'),('height','height.png'),('rough','packed.png'),('bands','bands.png')]:
            im=Image.open(folder/file);raw=np.asarray(im)
            src[key]=raw.astype(np.float64)/(65535 if key=='height' else 255)
            info['sources'][str((folder/file).relative_to(DODO))]=hashlib.sha256((folder/file).read_bytes()).hexdigest()
        x0,y0,x1,y1=rectangle(rects[kind]);w,h=x1-x0,y1-y0
        dx,dy=cfg['mm_per_texel']
        yy,xx=np.indices((h,w),dtype=float)
        source_mm=e['master_span_m']*1000/1024
        width_rows=surface_widths(kind,cfg['card_mm']);row_t,row_mm=np.array(width_rows).T
        surface_t=1-(yy+.5)/h
        physical_x=((xx+.5)/w-.5)*np.interp(surface_t,row_t,row_mm)
        physical_along=(1-(yy+.5)/h)*cfg['card_mm'][1]-cfg['root_above_bottom_mm']
        sx=e['master_root_px'][0]+physical_x/(source_mm*cfg['scale']*cfg['width_scale'])
        sy=e['master_root_px'][1]+physical_along/(source_mm*cfg['scale'])
        coords=np.array([sy,sx])
        def sample(a,order=1):
            return map_coordinates(a,coords,order=order,mode='constant',cval=0,prefilter=False)
        alpha=sample(src['base'][...,3]);valid=alpha>=.5
        # Free barb ends remain attached to their vane; remove isolated
        # resampling specks and retain only a narrow antialiasing halo.
        components,count=label(valid,structure=np.ones((3,3)))
        sizes=np.bincount(components.ravel());sizes[0]=0
        main=components==sizes.argmax()
        alpha[valid&~main]=0
        alpha[distance_transform_edt(~main)>1.5]=0
        valid=alpha>=.5
        lum=sample(decode(src['base'][...,0]));height=sample(src['height'])*HEIGHT_MM
        rough=sample(src['rough'][...,1]);band=sample(src['bands'],0)>.5
        reg=np.where(band,5,0) if kind=='tail' else np.full((h,w),5)
        height=extend(height,valid);rough=extend(rough,valid);reg=extend(reg,valid)
        n=normal(height,dx,dy)
        lum=calibrate(lum,alpha,reg,n,yy+y0)
        ao=occlusion(height,dx,dy)
        rgb=np.repeat(encode(lum)[...,None],3,-1)
        region=np.zeros((h,w,3));region[...,0]=1;region[...,1]=(reg==5)
        sl=np.s_[y0:y1,x0:x1]
        outputs['base'][sl]=np.dstack([rgb,alpha]);outputs['height'][sl]=height/HEIGHT_MM
        outputs['rough'][sl]=rough;outputs['occlusion'][sl]=ao;outputs['regions'][sl]=region
        ay,ax=np.where(valid)
        def target(point):
            px=(point[0]-e['master_root_px'][0])*source_mm*cfg['scale']*cfg['width_scale']
            along=(point[1]-e['master_root_px'][1])*source_mm*cfg['scale']+cfg['root_above_bottom_mm']
            surface_width=np.interp(along/cfg['card_mm'][1],row_t,row_mm)
            return [round(x0+w/2+px/surface_width*w-.5,4),round(y1-along/cfg['card_mm'][1]*h-.5,4)]
        info['card_rectangles'][kind]={**cfg,'uv':rects[kind],'box_px':[x0,y0,x1,y1],
            'pixel_mm':[dx,dy],'feather_root_to_tip_mm':e['length_m']*1000*cfg['scale'],
            'nominal_vane_width_mm':e['width_m']*1000*cfg['scale']*cfg['width_scale'],
            'surface_width_rows_t_mm':width_rows,
            'covered_box_px':[int(x0+ax.min()),int(y0+ay.min()),int(x0+ax.max()+1),int(y0+ay.max()+1)],
            'root_px':target(e['master_root_px']),'tip_px':target(e['master_tip_px']),
            'tail_band_width_mm':4.5*cfg['scale'] if kind=='tail' else 0,
            'tail_band_gap_mm':5*cfg['scale'] if kind=='tail' else 0,
            'tail_tip_margin_mm':4*cfg['scale'] if kind=='tail' else 0}
    for k,a in outputs.items():save(LAYERS/f'cards_{k}.png',a,bits=16 if k=='height' else 8,srgb=k=='base')
    # No opaque pieces belong to quills. Explicit empty layers make that clear.
    for k,a in outputs.items():save(LAYERS/f'dodo_{k}.png',np.zeros_like(a),bits=16 if k=='height' else 8,srgb=k=='base')
    (LAYERS/'layers.json').write_text(json.dumps(info,indent=2)+'\n')
    print('Painted tail_center and wing_finger_1 into their two shared card rectangles.')

if __name__=='__main__':paint()
