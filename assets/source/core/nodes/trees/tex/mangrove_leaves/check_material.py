#!/usr/bin/env python3
"""Independent measurements and material/billow previews from delivered PNGs.
No builder imports. Camera previews are a software diagnostic, not the engine.
"""
from pathlib import Path
import hashlib
import json
import math
import struct
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage as ndi
from scipy.spatial import ConvexHull

ROOT=Path(__file__).resolve().parent
OUT=ROOT/'checks'
SRC=ROOT/'source/set2'
BOXES=json.loads((ROOT/'guide/LAYOUT.json').read_text())['cells']
HEIGHT_MM=160.
FONT_PATH='/System/Library/Fonts/Supplemental/Arial.ttf'

def font(size=18):
    try:return ImageFont.truetype(FONT_PATH,size)
    except OSError:return ImageFont.load_default()

def byte(a):return np.clip(np.rint(a),0,255).astype(np.uint8)
def unit(a):return a/np.maximum(np.linalg.norm(a,axis=-1,keepdims=True),1e-10)
def linear(x):
    x=np.asarray(x)/255.
    return np.where(x<=.04045,x/12.92,((x+.055)/1.055)**2.4)
def srgb(x):return np.where(x<=.0031308,x*12.92,1.055*np.maximum(x,0)**(1/2.4)-.055)*255

def area(a,size):
    if a.ndim==3:return np.stack([np.array(Image.fromarray(a[...,c].astype(np.float32)).resize(size,Image.Resampling.BOX)) for c in range(a.shape[2])],-1)
    return np.array(Image.fromarray(a.astype(np.float32)).resize(size,Image.Resampling.BOX))

def rgb_image(a):return Image.fromarray(byte(a))
def composite(rgb,alpha,bg=(128,128,128),cut=True):
    alpha=(alpha>=.5).astype(float) if cut else alpha
    return rgb_image(rgb*alpha[...,None]+np.array(bg)*(1-alpha[...,None]))

def hull(mask):
    yy,xx=np.where(mask);points=np.column_stack([xx,yy])
    poly=points[ConvexHull(points).vertices]
    im=Image.new('L',(mask.shape[1],mask.shape[0]));ImageDraw.Draw(im).polygon([tuple(x) for x in poly],fill=255)
    return np.array(im)/255.

def connected(mask):
    labels,n=ndi.label(mask,np.ones((3,3)))
    sizes=np.bincount(labels.ravel())[1:]
    return dict(components=int(n),largest_fraction=float(sizes.max()/max(mask.sum(),1)) if n else 0)

def edge_widths(alpha):
    """Sample isolated cutout edges along their alpha-gradient normal."""
    gy,gx=np.gradient(ndi.gaussian_filter(alpha,.45))
    length=np.hypot(gx,gy)
    yy,xx=np.where((alpha>.2)&(alpha<.8)&(length>.1))
    if len(yy)==0:return []
    select=np.linspace(0,len(yy)-1,min(1200,len(yy))).astype(int)
    offsets=np.linspace(-3,3,121)
    results=[]
    for y,x in zip(yy[select],xx[select]):
        dx=gx[y,x]/length[y,x];dy=gy[y,x]/length[y,x]
        profile=ndi.map_coordinates(alpha,[y+offsets*dy,x+offsets*dx],order=1,mode='nearest')
        if profile[0]>.02 or profile[-1]<.98 or np.min(np.diff(profile))<-.015:continue
        results.append(float(np.interp(.9,profile,offsets)-np.interp(.1,profile,offsets)))
    return results

def png_format(path):
    data=path.read_bytes()
    w,h,depth,ctype=struct.unpack('>IIBB',data[16:26])
    im=Image.open(path)
    return dict(size=[w,h],bit_depth=depth,color_type=ctype,mode=im.mode,srgb=im.info.get('srgb'),icc='icc_profile' in im.info,sha256=hashlib.sha256(data).hexdigest())

def expected_normals(h,pitch,wrap):
    if wrap:
        gx=np.concatenate([h[:,1:],h[:,:1]],1)-np.concatenate([h[:,-1:],h[:,:-1]],1)
        gy=np.concatenate([h[1:],h[:1]],0)-np.concatenate([h[-1:],h[:-1]],0)
        gx/=2*pitch;gy/=2*pitch
    else:
        gx=np.empty_like(h);gy=np.empty_like(h)
        gx[:,1:-1]=(h[:,2:]-h[:,:-2])/(2*pitch)
        gy[1:-1]=(h[2:]-h[:-2])/(2*pitch)
        gx[:,0]=(h[:,1]-h[:,0])/pitch;gx[:,-1]=(h[:,-1]-h[:,-2])/pitch
        gy[0]=(h[1]-h[0])/pitch;gy[-1]=(h[-1]-h[-2])/pitch
    return unit(np.stack([-gx,gy,np.ones_like(h)],-1))

def light(rgb,n,orm,direction):
    direct=np.maximum(np.sum(n*unit(np.array(direction,float)),axis=-1),0)
    factor=.5*orm[...,0]+.5*direct
    return rgb*factor[...,None]

class Billow:
    """Triangle shell and tangent cards, z-buffer, filtered textures, shared normals."""
    def __init__(self,maps,distance=30,sparse=False):
        self.focal=960.;self.distance=distance
        self.scale=self.focal/distance
        self.w=int(round(3.3*self.scale));self.h=int(round(2.1*self.scale))
        self.maps=maps;self.sparse=sparse
        self.rgb=np.zeros((self.h,self.w,3));self.norm=np.zeros_like(self.rgb)
        self.orm=np.zeros_like(self.rgb);self.z=np.full((self.h,self.w),-np.inf)
        self.kind=np.zeros((self.h,self.w),np.uint8)
        self.region=np.full((self.h,self.w),255,np.uint8)
        self.tex={}
        for i,(rgb,a,n,orm) in enumerate(maps):
            physical=([.8,.8] if i<4 else [.45,.9] if i<6 else [4,2])
            size=tuple(max(1,int(round(v*self.scale))) for v in physical)
            self.tex[i]=(srgb(area(linear(rgb),size)),area(a,size),area(n,size),area(orm,size))
        self.mesh()

    def point(self,theta,phi):
        return np.array([1.06*math.cos(phi)*math.sin(theta),.61*math.sin(phi),.68*math.cos(phi)*math.cos(theta)])
    def model_normal(self,p):return unit(np.asarray(p)/np.array([1.06**2,.61**2,.68**2]))

    def sample(self,idx,uv,repeat=False):
        tex=self.tex[idx];h,w=tex[1].shape
        if idx==6 or repeat:uv=uv%1
        else:uv=np.clip(uv,0,1)
        coords=[uv[...,1]*(h-1),uv[...,0]*(w-1)]
        vals=[]
        for a in tex:
            if a.ndim==3:vals.append(np.stack([ndi.map_coordinates(a[...,c],coords,order=1,mode='wrap' if idx==6 else 'nearest') for c in range(a.shape[2])],-1))
            else:vals.append(ndi.map_coordinates(a,coords,order=1,mode='nearest'))
        return vals

    def triangle(self,pts,uv,idx,tangent,bitangent,kind):
        pts=np.array(pts);uv=np.array(uv)
        # Orthographic local projection at stated perspective pixel density.
        screen=np.stack([self.w/2+pts[:,0]*self.scale,self.h*.52-pts[:,1]*self.scale],1)
        lo=np.maximum(np.floor(screen.min(0)).astype(int),0)
        hi=np.minimum(np.ceil(screen.max(0)).astype(int)+1,[self.w,self.h])
        if np.any(lo>=hi):return
        yy,xx=np.mgrid[lo[1]:hi[1],lo[0]:hi[0]]
        a,b,c=screen
        den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1])
        if abs(den)<1e-7:return
        wa=((b[1]-c[1])*(xx+.5-c[0])+(c[0]-b[0])*(yy+.5-c[1]))/den
        wb=((c[1]-a[1])*(xx+.5-c[0])+(a[0]-c[0])*(yy+.5-c[1]))/den
        wc=1-wa-wb;weights=np.stack([wa,wb,wc],-1)
        sl=np.s_[lo[1]:hi[1],lo[0]:hi[0]]
        p=weights@pts;depth=p[...,2]
        hit=(weights.min(-1)>=-1e-6)&(depth>self.z[sl])
        if not hit.any():return
        rgb,alpha,detail,orm=self.sample(idx,weights@uv,kind==1)
        hit &= alpha>=.5
        if not hit.any():return
        normal=self.model_normal(p)
        # Common rounded normals for the shell and cards; texture axes rotate.
        tangent=np.broadcast_to(tangent,normal.shape)
        tangent=unit(tangent-normal*(tangent*normal).sum(-1,keepdims=True))
        bitan=unit(np.cross(normal,tangent))
        if np.dot(np.cross(self.model_normal(pts.mean(0)),np.asarray(tangent).reshape(-1,3)[0]),bitangent)<0:bitan=-bitan
        detail=unit(detail)
        n=unit(tangent*detail[...,0,None]+bitan*detail[...,1,None]+normal*detail[...,2,None])
        self.rgb[sl][hit]=rgb[hit];self.norm[sl][hit]=n[hit];self.orm[sl][hit]=orm[hit]
        self.z[sl][hit]=depth[hit];self.kind[sl][hit]=kind
        self.region[sl][hit]=idx

    def quad(self,pts,uv,idx,t,b,kind):
        for tri in [[0,1,2],[0,2,3]]:self.triangle([pts[j] for j in tri],[uv[j] for j in tri],idx,t,b,kind)

    def mesh(self):
        # A genuinely closed low polygon ellipsoid. Lower faces use rim cutouts.
        for j in range(10):
            p0=-math.pi/2+j*math.pi/10;p1=p0+math.pi/10
            for k in range(24):
                t0=-math.pi+k*2*math.pi/24;t1=t0+2*math.pi/24
                pts=[self.point(t0,p0),self.point(t1,p0),self.point(t1,p1),self.point(t0,p1)]
                mid=(t0+t1)*.5
                T=np.array([math.cos(mid),0,-math.sin(mid)]);B=np.array([0,1,0])
                idx=6 if (p0+p1)/2>-.36 else 1
                uv=[[t0*1.06/4,.5-p0*.61/2],[t1*1.06/4,.5-p0*.61/2],[t1*1.06/4,.5-p1*.61/2],[t0*1.06/4,.5-p1*.61/2]] if idx==6 else [[t0*1.06/.8,(.05-p0*.61)/.8],[t1*1.06/.8,(.05-p0*.61)/.8],[t1*1.06/.8,(.05-p1*.61)/.8],[t0*1.06/.8,(.05-p1*.61)/.8]]
                self.quad(pts,uv,idx,T,B,1)
        places=[(-1.05,.28,1,.18),(-.55,.70,0,-.4),(0,.77,2,.2),(.65,.62,0,.65),(1.18,.20,3,-.3),(-1.3,-.20,1,-.5),(-.62,-.42,3,.4),(.35,-.45,1,.3),(.99,-.27,3,-.2),(-.47,.05,0,-.2),(.40,.12,0,.5)]
        if self.sparse:places=[places[i] for i in [0,2,4,7]]
        for theta,phi,idx,angle in places:
            centre=self.point(theta,phi);N=self.model_normal(centre)
            T=unit(np.cross([0,1,0],N));B=unit(np.cross(N,T))
            t=T*math.cos(angle)+B*math.sin(angle);b=-T*math.sin(angle)+B*math.cos(angle)
            centre+=N*.07
            pts=[centre-t*.4-b*.4,centre+t*.4-b*.4,centre+t*.4+b*.4,centre-t*.4+b*.4]
            self.quad(pts,[[0,1],[1,1],[1,0],[0,0]],idx,t,b,2)

    def render(self,direction):
        mask=np.isfinite(self.z)
        rgb=light(self.rgb,self.norm,self.orm,direction)
        return composite(rgb,mask.astype(float),(181,209,235)),mask

def purpose(maps):
    lights=[(-.35,.65,1),(.10,.85,-1)]
    metrics=[];distance=30;scale=960/distance
    concept=Image.open(ROOT/'../../ref/concept/broadleaf/mangrove_lineup.png').convert('RGB')
    # M03's 7.4 m crown spans approximately 616 native pixels. This crop
    # therefore spans 3.30 m, rather than resizing a convenient crop to fit.
    crop=concept.crop((1100,90,1375,265))
    crop.save(OUT/'concept_billow_crop.png')
    for sparse in [False,True]:
        billow=Billow(maps,distance,sparse)
        row=[];light_metrics=[]
        for j,L in enumerate(lights):
            im,mask=billow.render(L);im.save(OUT/f'billow_30m_{"sparse_" if sparse else ""}{"front" if j==0 else "back"}.png');row.append(im)
            lit=light(billow.rgb,billow.norm,billow.orm,L)
            populations={name:np.isin(billow.region,regions)&mask for name,regions in [('sun',[0,2]),('shade',[1,3]),('mass',[6])]}
            values={name:dict(pixels=int(m.sum()),mean_rgb=lit[m].mean(0).tolist(),mean_srgb_luma=float((lit[m]*np.array([.2126,.7152,.0722])).sum(-1).mean())) for name,m in populations.items()}
            values['finite_render']=bool(np.isfinite(lit).all())
            values['sun_to_shade_luma_ratio']=values['sun']['mean_srgb_luma']/values['shade']['mean_srgb_luma']
            light_metrics.append(values)
        ref=crop.resize((round(3.30*scale),round(3.30*scale*crop.height/crop.width)),Image.Resampling.LANCZOS)
        for zoom in [1,4]:
            panel=max(190,billow.w*zoom+24)
            actual=Image.new('RGB',(panel*3+20,billow.h*zoom+100),(28,32,35));d=ImageDraw.Draw(actual)
            for j,im in enumerate(row+[ref]):
                x=10+j*panel
                d.text((x+4,12),['Sun behind viewer','Sun high behind billow','Concept / inferred scale'][j],font=font(13 if zoom==1 else 19),fill='white')
                actual.paste(im.resize((im.width*zoom,im.height*zoom),Image.Resampling.NEAREST),(x+(panel-im.width*zoom)//2,48))
            d.text((16,billow.h*zoom+64),f'30 m / 1920 px / 90 deg HFOV / 32 px per metre / {zoom}x nearest-neighbour display',font=font(12 if zoom==1 else 16),fill=(180,187,192))
            actual.save(OUT/f'purpose_30m_{"sparse" if sparse else "both_lights"}{"_enlarged" if zoom>1 else ""}.png')
        metrics.append(dict(sparse=sparse,frame_px=[billow.w,billow.h],metres_per_pixel=1/scale,card_frontal_width_px=.8*scale,visible_pixels=int(np.isfinite(billow.z).sum()),visible_card_pixels=int((billow.kind==2).sum()),lights=light_metrics))
    near=Billow(maps,3,False)
    for j,L in enumerate(lights):near.render(L)[0].save(OUT/f'billow_3m_{j}.png')
    return dict(camera_width=1920,horizontal_fov_deg=90,distance_m=distance,focal_px=960,projection='orthographic local approximation at 30 m perspective density',shell_dimensions_m=[2.12,1.22,1.36],shell_quads=240,light_directions=lights,concept_crop_pixels=[1100,90,1375,265],concept_crop_estimated_width_m=3.30,concept_native_pixels_per_metre=616/7.4,views=metrics)

def main():
    OUT.mkdir(exist_ok=True)
    images={name:Image.open(ROOT/f'mangrove_leaves_{name}.png') for name in ['base','height','normal','orm']}
    base=np.array(images['base']);height=np.array(images['height']).astype(float)*HEIGHT_MM/65535
    normals=unit(np.array(images['normal']).astype(float)/127.5-1);orm=np.array(images['orm']).astype(float)/255
    ids=np.array(Image.open(SRC/'surface_ids.png'));kind=np.array(Image.open(SRC/'surface_kind.png'));depth=np.array(Image.open(SRC/'surface_depth.png'))/255
    exposure=np.array(Image.open(SRC/'tissue_exposure.png'))/255
    preservation=json.loads((SRC/'round2_preservation.json').read_text())
    failures=[];assertions=[]
    def test(name,value):
        assertions.append(dict(name=name,pass_=bool(value)))
        if not value:failures.append(name)
    formats={k:png_format(ROOT/f'mangrove_leaves_{k}.png') for k in images}
    for k,f in formats.items():
        test(k+' dimensions',f['size']==[2048,2048]);test(k+' format',f['bit_depth']==(16 if k=='height' else 8) and f['color_type']==(6 if k=='base' else 0 if k=='height' else 2))
        test(k+' color space',f['srgb']==0 if k=='base' else f['srgb'] is None and not f['icc'])
    test('mass opaque',np.all(base[1024:,:,3]==255));test('metalness zero',np.all(orm[...,2]==0))
    metrics=dict(formats=formats,height_range_mm=HEIGHT_MM,regions=[],mass_opaque=bool(np.all(base[1024:,:,3]==255)))
    actual_arrays=dict(alpha=base[...,3],roughness=np.array(images['orm'])[...,1],metalness=np.array(images['orm'])[...,2],cutout_ao=np.array(images['orm'])[:1024,:,0],visible_cell_twigs_and_brown=base[:1024,:1024,:3][np.isin(kind[:1024,:1024],[4,5])&(base[:1024,:1024,3]>=128)])
    actual_arrays.update({'strips_'+k:np.array(im)[:1024,1024:] for k,im in images.items()})
    kept={}
    for name,expected_hash in preservation['arrays'].items():
        kept[name]=hashlib.sha256(np.ascontiguousarray(actual_arrays[name]).tobytes()).hexdigest()==expected_hash
    for name,expected_hash in preservation['files'].items():
        kept[name]=hashlib.sha256((ROOT/name).read_bytes()).hexdigest()==expected_hash
    for name,ok in kept.items():test('preserved '+name,ok)
    metrics['round2_preservation']=kept
    maps=[]
    mip_sheets={bg:Image.new('RGB',(1170,600),(36,39,42)) for bg in ['grey','sky']}
    for i,r in enumerate(BOXES):
        x0,y0,x1,y1=r['box'];sl=np.s_[y0:y1,x0:x1]
        rgb=base[sl][...,:3];a=base[sl][...,3]/255.;vis=a>=.5;h=height[sl];n=normals[sl];o=orm[sl]
        maps.append((rgb,a,n,o));pitch=r['metres_across']*1000/(x1-x0)
        expected=expected_normals(h,pitch,i==6)
        angles=np.degrees(np.arccos(np.clip((expected*n).sum(-1),-1,1)))[vis]
        means=rgb[vis].mean(0)
        stats=dict(name=f'cell_{i}' if i<4 else f'strip_{i-3}' if i<6 else 'mass',mean_rgb=means.tolist(),height_mm=[float(h[vis].min()),float(h[vis].max())],roughness=[float(o[...,1][vis].min()),float(o[...,1][vis].max())],occlusion=[float(o[...,0][vis].min()),float(o[...,0][vis].max())],normal_error_degrees=dict(mean=float(angles.mean()),p99=float(np.percentile(angles,99)),max=float(angles.max())),normal_tilt_degrees=np.percentile(np.degrees(np.arccos(np.clip(n[...,2][vis],-1,1))),[10,50,90]).tolist())
        target=[104,126,62] if i in [0,2] else [64,86,56] if i in [1,3] else [76,98,56] if i<6 else [50,68,44]
        stats['target_rgb']=target
        test(stats['name']+' mean colour',np.max(abs(means-target))<.6)
        test(stats['name']+' normal/height',angles.max()<.45)
        test(stats['name']+' matte',o[...,1][vis].min()>=.90 and o[...,1][vis].max()<=.951)
        test(stats['name']+' AO',o[...,0][vis].min()>=(.749 if i<6 else .349))
        if i<4:
            leaves=vis&(kind[sl]>=1)&(kind[sl]<=3)
            stats['leaf_colour_p01_p50_p99']=np.percentile(rgb[leaves],[1,50,99],axis=0).tolist()
            if i==2:
                fresh=vis&(kind[sl]==3)
                stats['fresh_mean_rgb']=rgb[fresh].mean(0).tolist()
                stats['fresh_p90_rgb']=np.percentile(rgb[fresh],90,axis=0).tolist()
                test('cell 2 yellow-green fresh tips',np.max(abs(np.percentile(rgb[fresh],90,axis=0)-[160,170,72]))<6)
                test('cell 2 fresh growth is brightest',min(rgb[fresh].mean(0)[:2]-np.max(base[..., :3][(kind==1)|(kind==2)],axis=0)[:2])>0)
        uniform=(ndi.minimum_filter(ids[sl],size=5)==ndi.maximum_filter(ids[sl],size=5))&vis&(kind[sl]>0)&(kind[sl]<5)
        tilts=np.degrees(np.arccos(np.clip(n[...,2][uniform],-1,1)))
        stats['interior_leaf_tilt_degrees']=np.percentile(tilts,[10,50,90]).tolist()
        test(stats['name']+' tilted leaf interiors',20<float(np.median(tilts))<50)
        if i<6:
            margin=np.zeros(a.shape,bool);margin[:12]=True;margin[-12:]=True;margin[:,:12]=True;margin[:,-12:]=True
            exception=np.zeros_like(margin);exception[-12:,a.shape[1]//2-9:a.shape[1]//2+9]=True
            stats['forbidden_margin_nonzero_alpha']=int(np.count_nonzero(a[margin&~exception]))
            test(stats['name']+' margins',stats['forbidden_margin_nonzero_alpha']==0)
            test(stats['name']+' twig enters bottom centre',a[-1,a.shape[1]//2]>=.5)
            _,ix=ndi.distance_transform_edt(~vis,return_indices=True)
            err=np.abs(rgb.astype(int)-rgb[ix[0],ix[1]].astype(int))[~vis]
            stats['transparent_rgb_max_error']=int(err.max());test(stats['name']+' padding',err.max()==0)
            stats['connectivity']=connected(vis)
            widths=edge_widths(a)
            stats['alpha_edge_10_90_width_px']=dict(samples=len(widths),p10_p50_p90=np.percentile(widths,[10,50,90]).tolist())
            test(stats['name']+' soft alpha edge',1.0<np.median(widths)<2.1)
            outline=hull(vis);scalloped=ndi.binary_fill_holes(ndi.binary_closing(vis,iterations=9)).astype(float)
            # Include attachment in the outline, but its thin end may vanish at distance.
            stats['mips']=[]
            for j,factor in enumerate([1,2,4,8,16]):
                size=(a.shape[1]//factor,a.shape[0]//factor)
                aa=area(a,size);cut=aa>=.5;rr=srgb(area(linear(rgb),size))
                cv=area(outline,size);sc=area(scalloped,size)
                m=dict(factor=factor,size=list(size),convex_coverage=float(cut.sum()/cv.sum()),scalloped_coverage=float((cut*sc).sum()/max(sc.sum(),1)),area_retention=float(cut.sum()*factor**2/vis.sum()),**connected(cut));stats['mips'].append(m)
                if i<4:
                    test(stats['name']+f' mip {factor} density',m['convex_coverage']>.62)
                    test(stats['name']+f' mip {factor} area',.90<m['area_retention']<1.12)
                if factor>1:
                    for bg,c in [('grey',(128,128,128)),('sky',(181,209,235))]:
                        im=composite(rr,aa,c);im.save(OUT/f'{stats["name"]}_mip_{factor:02}_{bg}.png')
                        if i<4:
                            ox=15+i*289;oy=32+[0,278,427,512][j-1]
                            mip_sheets[bg].paste(im,(ox,oy));ImageDraw.Draw(mip_sheets[bg]).text((ox,oy-20),f'Cell {i} / {factor}',font=font(14),fill='white')
            composite(rgb,a,(181,209,235),False).save(OUT/f'{stats["name"]}_base.png')
        else:
            seam={}
            for name,a2 in [('base',rgb),('height',h),('normal',n),('orm',o)]:
                dx=np.abs(np.diff(a2.astype(float),axis=1));dy=np.abs(np.diff(a2.astype(float),axis=0))
                seam[name]=dict(x=float(np.abs(a2[:,0].astype(float)-a2[:,-1].astype(float)).mean()/max(dx.mean(),1e-9)),y=float(np.abs(a2[0].astype(float)-a2[-1].astype(float)).mean()/max(dy.mean(),1e-9)))
            stats['seam_over_interior_difference']=seam
            for name,s in seam.items():test(name+' tile seam',max(s.values())<1.65)
            top=exposure[sl]>.93;low=exposure[sl]<.5
            stats['exposed_top_mean']=rgb[top].mean(0).tolist();stats['hollow_mean']=rgb[low].mean(0).tolist();stats['hollow_fraction']=float(low.mean())
            stats['deepest_rgb_p01']=np.percentile(rgb.reshape(-1,3),1,axis=0).tolist()
            stats['base_min_rgb']=rgb.min((0,1)).tolist()
            stats['ao_below_065_fraction']=float((o[...,0]<.65).mean())
            stats['previous_hollow_fraction']=preservation['mass_before']['hollow_fraction']
            test('mass expanded pooled hollows',stats['hollow_fraction']>stats['previous_hollow_fraction']+.05)
            test('mass cool deep pigment floor',np.max(abs(np.array(stats['base_min_rgb'])-[24,36,30]))<3)
            test('mass deep occlusion',abs(o[...,0].min()-.35)<.005)
            test('mass pooled hollow occlusion',stats['ao_below_065_fraction']>.48)
            rgb_image(np.tile(rgb,(2,2,1))).save(OUT/'mass_tiled_2x2.png')
            rgb_image(np.tile(rgb,(2,2,1))).resize((1200,600),Image.Resampling.LANCZOS).save(OUT/'mass_tiled_overview.jpg',quality=94)
            rgb_image(np.roll(rgb,(512,1024),(0,1))).save(OUT/'mass_offset.png')
        metrics['regions'].append(stats)
    tops=np.array(metrics['regions'][-1]['exposed_top_mean'])
    metrics['mass_top_vs_shade_mean_max_channel_difference']=float(np.max(np.abs(tops-np.array([64,86,56]))))
    test('shade cards and exposed mass palette match',metrics['mass_top_vs_shade_mean_max_channel_difference']<2)
    for bg,im in mip_sheets.items():im.save(OUT/f'mips_{bg}.jpg',quality=95)
    Image.fromarray(base[...,3]).save(OUT/'alpha.png')
    guide=Image.open(ROOT/'guide/layout.png').convert('RGBA')
    Image.alpha_composite(guide,Image.fromarray(base)).convert('RGB').save(OUT/'base_over_layout.png')
    sheet=Image.new('RGB',(1400,1460),(29,32,35));d=ImageDraw.Draw(sheet)
    previews=[composite(base[...,:3],base[...,3]/255,cut=False),rgb_image(height/HEIGHT_MM*255),images['normal'],images['orm']]
    for i,im in enumerate(previews):
        x=(i%2)*700;y=(i//2)*730
        if i:
            ar=np.array(im.convert('RGB'));im=composite(ar,base[...,3]/255,cut=False)
        sheet.paste(im.resize((680,680),Image.Resampling.LANCZOS),(x+10,y+36));d.text((x+12,y+8),['BASE / sRGB + alpha','HEIGHT / 16 bit / 0-160 mm','NORMAL / OpenGL / physical scale','ORM / linear / matte'][i],font=font(19),fill='white')
    sheet.save(OUT/'layers.jpg',quality=95)
    lit=[]
    for j,L in enumerate([(-.65,.7,.9),(.65,-.7,.9)]):
        im=composite(light(base[...,:3],normals,orm,L),base[...,3]/255,(101,110,120),False)
        im.save(OUT/f'lit_{j}.png');lit.append(im)
    rel=Image.new('RGB',(1600,830),(29,32,35));d=ImageDraw.Draw(rel)
    for j,im in enumerate(lit):rel.paste(im.resize((800,800)),(j*800,30));d.text((j*800+14,5),['Upper-left light','Lower-right light'][j],font=font(),fill='white')
    rel.save(OUT/'relighting.jpg',quality=95)
    detail=Image.new('RGB',(1536,1040),(29,32,35));d=ImageDraw.Draw(detail)
    for row,box in enumerate([(0,0,512,512),(600,1200,1112,1712)]):
        for col,im in enumerate([previews[0],lit[0],lit[1]]):detail.paste(im.crop(box),(col*512,row*520+8))
    detail.save(OUT/'leaf_detail.jpg',quality=96)
    metrics['purpose']=purpose(maps)
    for view in metrics['purpose']['views']:
        for j,values in enumerate(view['lights']):
            test(f'30 m {"sparse" if view["sparse"] else "full"} light {j} sun/shade separation',values['sun_to_shade_luma_ratio']>1.2)
            test(f'30 m {"sparse" if view["sparse"] else "full"} light {j} finite render',values['finite_render'])
    comp=json.loads((SRC/'composition.json').read_text())
    metrics['construction']=[dict(name=r['name'],rosettes=len(r['groups']),leaves=len(r['leaves']),leaf_length_mm=[min(l['projected_length_mm'] for l in r['leaves']),max(l['projected_length_mm'] for l in r['leaves'])],tilt_deg=[min(l['tilt_deg'] for l in r['leaves']),max(l['tilt_deg'] for l in r['leaves'])],underside_leaves=sum(l['kind']==2 for l in r['leaves']),fresh_leaves=sum(l['kind']==3 for l in r['leaves']),brown_leaves=sum(l['kind']==4 for l in r['leaves'])) for r in comp['regions']]
    metrics['assertions']=assertions;metrics['assertion_count']=len(assertions);metrics['failures']=failures;metrics['passed']=not failures
    (OUT/'metrics.json').write_text(json.dumps(metrics,indent=2)+'\n')
    print(json.dumps(dict(assertions=len(assertions),failures=failures,means=[r['mean_rgb'] for r in metrics['regions']]),indent=2))
    if failures:raise SystemExit(1)

if __name__=='__main__':main()
