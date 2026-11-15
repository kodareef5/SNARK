#!/usr/bin/env python3
"""Independent file/physics checks and software-rendered review sheets.

No renderer or SciPy dependency: Python 3, NumPy and Pillow suffice.
The normal verification deliberately does not import the build implementation.
"""
from pathlib import Path
import hashlib
import json
import math
import struct
import time

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
OUT = ROOT/'checks'
TILE_MM = 200.0
HEIGHT_MM = 2.5
RESAMPLE = Image.Resampling.LANCZOS
FONT_PATH = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'


def font(size):
    try:
        return ImageFont.truetype(FONT_PATH,size)
    except OSError:
        return ImageFont.load_default()


def rgb(a):
    a = np.asarray(a)
    if a.ndim==2:
        a = np.repeat(a[:,:,None],3,axis=-1)
    if a.dtype==np.uint8:
        return Image.fromarray(a)
    return Image.fromarray(np.clip(np.rint(a),0,255).astype(np.uint8))


def norm(v):
    return v/np.maximum(np.linalg.norm(v,axis=-1,keepdims=True),1e-10)


def srgb_decode(v):
    return np.where(v<=.04045,v/12.92,((v+.055)/1.055)**2.4)


def srgb_encode(v):
    v=np.maximum(v,0)
    return np.where(v<=.0031308,v*12.92,1.055*v**(1/2.4)-.055)


def shade(base,n,rough,ao,light):
    """Lambert + dielectric GGX, linear-light shading, fixed exposure.

    Deliberately no displacement, geometric AO, transmission, or cast shadows.
    F0=.04; one white key and a uniform ambient fill.
    """
    n=norm(n)
    l=norm(np.array(light,dtype=np.float32))
    v=np.array([0.,0.,1.],dtype=np.float32)
    h=norm(l+v)
    nl=np.clip(np.sum(n*l,axis=-1),0,1)
    nv=np.clip(n[:,:,2],.001,1)
    nh=np.clip(np.sum(n*h,axis=-1),0,1)
    vh=float(np.dot(v,h))
    a2=np.maximum(rough,.05)**4
    d=a2/(np.pi*(nh*nh*(a2-1)+1)**2+1e-7)
    k=(rough+1)**2/8
    g=(nl/(nl*(1-k)+k+.0001))*(nv/(nv*(1-k)+k))
    fresnel=.04+.96*(1-vh)**5
    spec=d*g*fresnel/(4*nl*nv+1e-5)
    color=srgb_decode(base/255.)*(.26*ao[:,:,None]+.96*nl[:,:,None])
    color += (.96*np.pi*spec*nl)[:,:,None]
    return np.clip(srgb_encode(color)*255,0,255)


def panel_sheet(panels, cols, cell=(480,480), title=None):
    w,h=cell
    title_h=54 if title else 0
    rows=math.ceil(len(panels)/cols)
    out=Image.new('RGB',(cols*w,rows*(h+38)+title_h),(24,27,31))
    d=ImageDraw.Draw(out)
    if title:
        d.text((16,13),title,font=font(22),fill=(234,235,229))
    for i,(label,im) in enumerate(panels):
        im=im.copy()
        im.thumbnail((w-12,h),RESAMPLE)
        px=(i%cols)*w+(w-im.width)//2
        py=(i//cols)*(h+38)+title_h
        out.paste(im,(px,py))
        d.text(((i%cols)*w+9,py+h+8),label,font=font(15),fill=(222,225,224))
    return out


def png_header(p):
    raw=p.read_bytes()
    width,height,depth,kind=struct.unpack('>IIBB',raw[16:26])
    chunks=[]
    i=8
    while i<len(raw):
        size=struct.unpack('>I',raw[i:i+4])[0]
        chunks.append(raw[i+4:i+8].decode('ascii'))
        i+=size+12
    return dict(width=width,height=height,bit_depth=depth,color_type=kind,chunks=chunks,
                sha256=hashlib.sha256(raw).hexdigest())


def independent_normal(h):
    d=TILE_MM/h.shape[0]
    right=np.concatenate([h[:,1:],h[:,:1]],axis=1)
    left=np.concatenate([h[:,-1:],h[:,:-1]],axis=1)
    down=np.concatenate([h[1:,:],h[:1,:]],axis=0)
    up=np.concatenate([h[-1:,:],h[:-1,:]],axis=0)
    v=norm(np.stack(((left-right)/(2*d),(down-up)/(2*d),np.ones_like(h)),axis=2))
    return np.rint((v+1)*127.5).astype(np.uint8),v


def area_half(a):
    return a.astype(np.float64).reshape(a.shape[0]//2,2,a.shape[1]//2,2,*a.shape[2:]).mean((1,3))


def sample(a,uv):
    # Periodic bilinear samples, UV origin at image top left.
    n=a.shape[0]
    x=uv[:,:,0]*n-.5
    y=uv[:,:,1]*n-.5
    xi=np.floor(x).astype(int)
    yi=np.floor(y).astype(int)
    tx=(x-xi)[:,:,None]
    ty=(y-yi)[:,:,None]
    if a.ndim==2:
        a=a[:,:,None]
    return ((a[yi%n,xi%n]*(1-tx)+a[yi%n,(xi+1)%n]*tx)*(1-ty)+
            (a[(yi+1)%n,xi%n]*(1-tx)+a[(yi+1)%n,(xi+1)%n]*tx)*ty)


def blade_mesh():
    # mm: blunt butt at left, convex knapped cutting edge at right. Front-side
    # faceting is actual mesh geometry, not a color baked into the material.
    vertices=np.array([
        [-48,-34,1],[-22,-49,1],[10,-62,0],[37,-58,0],[48,-43,0],
        [54,-18,0],[56,8,0],[50,34,0],[35,56,0],[13,62,0],
        [-20,47,1],[-48,30,1],[-38,-23,11],[-19,-32,17],
        [9,-35,18],[27,-40,10],[38,-26,9],[42,-4,8],
        [36,22,10],[22,41,9],[0,35,16],[-24,27,17],[-32,3,21],[5,0,24],
    ],dtype=np.float64)
    faces=[(0,1,13),(0,13,12),(1,2,14),(1,14,13),(2,3,15),(2,15,14),
           (3,4,16),(3,16,15),(4,5,17),(4,17,16),(5,6,17),(6,7,18),(6,18,17),
           (7,8,19),(7,19,18),(8,9,19),(9,10,20),(10,21,20),(10,11,21),
           (11,0,12),(11,12,22),(11,22,21),
           (12,13,22),(13,14,23),(13,23,22),(14,15,23),(15,16,23),(16,17,23),
           (17,18,23),(18,19,23),(19,20,23),(20,21,22),(20,22,23),(9,19,20)]
    # Give the central facets slightly non-coplanar bulbar shape, while preserving
    # flat triangles. Winding is fixed when deriving tangent frames.
    mapped=[]
    edge_outer=set(range(3,10))
    edge_inner=set(range(15,20))
    for i,f in enumerate(faces):
        p=vertices[list(f)]
        if set(f)<=(edge_outer|edge_inner):
            region='edge'
            uv=np.array([[(q[1]+65)/200+.08,.059 if k in edge_outer else .115] for k,q in zip(f,p)])
        elif i in (0,1,19):
            region='cortex'
            uv=np.column_stack(((p[:,1]+70)/200+.12,.155+(p[:,0]+48)/30*.055))
            uv[:,1]=np.clip(uv[:,1],.145,.23)
        else:
            region='face'
            # 200 mm UV tile, no region crossing; each triangle lies in the face.
            uv=np.column_stack(((p[:,0]+58)/200+.09,(p[:,1]+65)/200+.315))
        mapped.append((f,uv,region))
    return vertices,mapped


def render_blade(base,normal,orm,light,res=640,unlit=False):
    verts,faces=blade_mesh()
    # View slightly across the blade. Orthographic projection preserves flat facets.
    ay=.22
    rot=np.array([[np.cos(ay),0,np.sin(ay)],[0,1,0],[-np.sin(ay),0,np.cos(ay)]])
    verts=verts@rot.T
    screen=np.column_stack((verts[:,0]*res/165+res*.49,-verts[:,1]*res/165+res*.51))
    image=np.zeros((res,res,3),np.float64)+[29,33,38]
    zbuffer=np.full((res,res),-1e6)
    for f,uv,region in faces:
        p=verts[list(f)]
        s=screen[list(f)]
        x0=max(0,int(np.floor(s[:,0].min())))
        x1=min(res,int(np.ceil(s[:,0].max()))+1)
        y0=max(0,int(np.floor(s[:,1].min())))
        y1=min(res,int(np.ceil(s[:,1].max()))+1)
        if x1<=x0 or y1<=y0:
            continue
        yy,xx=np.mgrid[y0:y1,x0:x1]
        xx=xx+.5
        yy=yy+.5
        den=(s[1,1]-s[2,1])*(s[0,0]-s[2,0])+(s[2,0]-s[1,0])*(s[0,1]-s[2,1])
        if abs(den)<1e-7:
            continue
        w0=((s[1,1]-s[2,1])*(xx-s[2,0])+(s[2,0]-s[1,0])*(yy-s[2,1]))/den
        w1=((s[2,1]-s[0,1])*(xx-s[2,0])+(s[0,0]-s[2,0])*(yy-s[2,1]))/den
        w2=1-w0-w1
        weights=np.stack((w0,w1,w2),-1)
        z=weights@p[:,2]
        mask=(weights.min(-1)>=-1e-5)&(z>zbuffer[y0:y1,x0:x1])
        if not mask.any():
            continue
        q=weights@uv
        albedo=sample(base,q)
        data=sample(orm,q)/255
        tn=norm(sample(normal,q)/127.5-1)
        dp1,dp2=p[1]-p[0],p[2]-p[0]
        du1,du2=uv[1]-uv[0],uv[2]-uv[0]
        det=du1[0]*du2[1]-du1[1]*du2[0]
        n=norm(np.cross(dp1,dp2))
        if n[2]<0:
            n=-n
        if abs(det)<1e-8:
            t=norm(dp1)
            b=norm(np.cross(n,t))
        else:
            t=norm((dp1*du2[1]-dp2*du1[1])/det)
            t=norm(t-n*np.dot(t,n))
            up=-(dp2*du1[0]-dp1*du2[0])/det
            b=norm(np.cross(n,t))
            if np.dot(b,up)<0:
                b=-b
        world=norm(tn[:,:,0,None]*t+tn[:,:,1,None]*b+tn[:,:,2,None]*n)
        color=albedo if unlit else shade(albedo,world,data[:,:,1],data[:,:,0],light)
        image[y0:y1,x0:x1][mask]=color[mask]
        zbuffer[y0:y1,x0:x1][mask]=z[mask]
    return rgb(image)


def write_mesh():
    verts,faces=blade_mesh()
    lines=['# Diagnostic hatchet blade. Units metres; vt uses bottom-left origin.']
    lines += ['v %.8f %.8f %.8f'%tuple(p/1000) for p in verts]
    for f,uv,region in faces:
        lines += ['vt %.8f %.8f'%(q[0],1-q[1]) for q in uv]
    for i,(f,uv,region) in enumerate(faces):
        lines += [f'g {region}', 'f '+' '.join(f'{v+1}/{i*3+j+1}' for j,v in enumerate(f))]
    (OUT/'hatchet_preview.obj').write_text('\n'.join(lines)+'\n')


def check():
    start=time.monotonic()
    OUT.mkdir(exist_ok=True)
    names=['stone_base','flint_base','stone_height','stone_normal','stone_orm','flint_orm']
    maps={n:np.array(Image.open(ROOT/f'{n}.png')) for n in names}
    small={n:np.array(Image.open(ROOT/f'{n}_1024.png')) for n in names}
    metrics={'files':{},'normal':{},'downsample':{},'seams':{},'regions':{},'assertions':[]}
    def require(ok,message):
        metrics['assertions'].append({'passed':bool(ok),'check':message})
    for n in names:
        for suffix,size in [('',2048),('_1024',1024)]:
            meta=png_header(ROOT/f'{n}{suffix}.png')
            metrics['files'][n+suffix]=meta
            require(meta['width']==size and meta['height']==size,f'{n}{suffix}: dimensions')
            require(meta['bit_depth']==(16 if 'height' in n else 8),f'{n}{suffix}: bit depth')
            require(meta['color_type']==(0 if 'height' in n else 2),f'{n}{suffix}: channels')
            require(('sRGB' in meta['chunks'])==('base' in n),f'{n}{suffix}: colour space')
            if 'base' not in n:
                require(not ({'sRGB','iCCP','gAMA'}&set(meta['chunks'])),f'{n}{suffix}: untagged linear data')
        hi=maps[n]
        lo=small[n]
        reference=area_half(hi)
        mse=float(np.mean((reference-lo)**2))
        peak=65535 if 'height' in n else 255
        psnr=10*np.log10(peak*peak/max(mse,1e-20))
        metrics['downsample'][n]={'psnr_db':float(psnr),'rmse':float(np.sqrt(mse)),'max_error':float(np.max(abs(reference-lo)))}
        require(psnr>=30,f'{n}: 1024 agrees with area-filtered 2048 at >=30 dB')
        lanczos=np.asarray(Image.fromarray(hi.astype(np.float32) if 'height' in n else hi).resize((1024,1024),RESAMPLE)).astype(np.float64)
        lanczos_mse=float(np.mean((lanczos-lo)**2))
        lanczos_psnr=10*np.log10(peak*peak/max(lanczos_mse,1e-20))
        metrics['downsample'][n]['lanczos_psnr_db']=float(lanczos_psnr)
        require(lanczos_psnr>=30,f'{n}: 1024 also agrees with Lanczos reduction at >=30 dB')
        # A seam is an adjacent pair of samples. Compare with nearby line jumps;
        # at top/bottom this includes the intended 4 mm material transition.
        a=hi.astype(np.float64)
        seam={}
        for axis,label in [(1,'x'),(0,'y')]:
            differences=np.abs(np.roll(a,-1,axis)-a)
            reduction=tuple(i for i in range(a.ndim) if i!=axis)
            line=differences.mean(axis=reduction)
            ref=np.concatenate((line[:40],line[-41:-1]))
            seam[label]={'wrap_mean':float(line[-1]),'interior_median':float(np.median(line[:-1])),
                         'near_wrap_p95':float(np.percentile(ref,95)),
                         'wrap_over_near_p95':float(line[-1]/max(np.percentile(ref,95),1e-8))}
            require(line[-1] <= max(np.percentile(ref,95)*1.6,.8 if 'height' not in n else 12),f'{n}: {label} seam has no discontinuity')
        metrics['seams'][n]=seam
    for size,arr in [(2048,maps),(1024,small)]:
        h=arr['stone_height'].astype(np.float64)/65535*HEIGHT_MM
        expect,v=independent_normal(h)
        actual=arr['stone_normal']
        diff=np.abs(actual.astype(int)-expect.astype(int))
        dec=norm(actual/127.5-1)
        angle=np.degrees(np.arccos(np.clip((dec*v).sum(-1),-1,1)))
        metrics['normal'][str(size)]={'max_byte_error':int(diff.max()),'mismatched_channels':int(np.count_nonzero(diff)),
                    'mean_quantization_angle_deg':float(angle.mean()),'max_quantization_angle_deg':float(angle.max()),
                    'tilt_p50_p95_deg':np.percentile(np.degrees(np.arccos(v[:,:,2])),[50,95]).tolist()}
        require(diff.max()==0,f'{size}: saved normal exactly matches independent height derivative')
    h=maps['stone_height'].astype(np.float64)/65535*HEIGHT_MM
    metrics['height_mm']={'full_range':[0,HEIGHT_MM],'actual_range':[float(h.min()),float(h.max())],
                         'rms':float(h.std()),'texel_mm':200/2048}
    fields=np.load(ROOT/'source/construction_fields.npz')
    reconstruction=1.35+sum(fields[k] for k in ['ripple_mm','secondary_mm','step_mm','retouch_mm','pits_mm','inclusion_mm','cortex_mm','grain_mm'])
    metrics['height_mm']['source_reconstruction_max_mm']=float(np.abs(h-reconstruction).max())
    require(np.abs(h-reconstruction).max()<HEIGHT_MM/65535*.51+1e-6,'saved height reconstructs from physical source fields')
    require(np.count_nonzero(maps['stone_orm'][:,:,2])==0 and np.count_nonzero(maps['flint_orm'][:,:,2])==0,'metalness is zero in both colourways')
    require(np.array_equal(maps['stone_orm'][:,:,0],maps['flint_orm'][:,:,0]),'both colourways use identical cavity AO')
    # Profile locations are checked against exact row assignment, separately from
    # the natural soft boundary masks.
    edge_profile=fields['edge_mask'].mean(axis=1)
    cortex_profile=fields['cortex_mask'].mean(axis=1)
    require(edge_profile[128]>.99 and cortex_profile[384]>.99,'band centres are at rows 128 and 384')
    require(abs(float(cortex_profile[256])-.5)<.05 and abs(float(cortex_profile[512])-.5)<.05,'cortex transitions are centred at rows 256 and 512')
    require(abs(float(edge_profile[0])-.5)<.05 and abs(float(edge_profile[-1])-.5)<.05,'edge wraps softly across rows 2047/0')
    metrics['band_rows']={'edge':[0,256],'cortex':[256,512],'face':[512,2048],
                         'boundary_fade_pixels':4/200*2048,'cortex_profile_at_256_512':[float(cortex_profile[256]),float(cortex_profile[512])]}
    regions={'face':np.s_[564:2007,:],'edge_middle_third':np.s_[86:170,:],'cortex_interior':np.s_[298:470,:]}
    for color in ['stone','flint']:
        metrics['regions'][color]={}
        for region,index in regions.items():
            b=maps[f'{color}_base'][index]
            orm=maps[f'{color}_orm'][index]/255.
            metrics['regions'][color][region]={'mean_srgb':b.mean((0,1)).tolist(),'std_srgb':b.std((0,1)).tolist(),
                    'roughness_mean':float(orm[:,:,1].mean()),'roughness_p01_p99':np.percentile(orm[:,:,1],[1,99]).tolist(),
                    'ao_mean':float(orm[:,:,0].mean()),'ao_min':float(orm[:,:,0].min())}
        target=[128,126,120] if color=='stone' else [74,72,76]
        require(np.max(np.abs(np.array(metrics['regions'][color]['face']['mean_srgb'])-target))<.5,f'{color}: face mean matches requested palette')
    open_area=(np.abs(fields['pits_mm'])<1e-6)&(np.abs(fields['step_mm'])<1e-6)&(np.abs(fields['retouch_mm'])<1e-6)
    require(np.all(maps['stone_orm'][:,:,0][open_area]==255),'AO is white outside pits, steps, and retouch notches')
    # Native-frequency energy lost at half resolution demonstrates added sub-2048 detail.
    reexpanded=np.repeat(np.repeat(area_half(h),2,axis=0),2,axis=1)
    metrics['native_detail_rms_mm']=float(np.sqrt(np.mean((h-reexpanded)**2)))
    records=json.loads((ROOT/'source/construction.json').read_text())
    metrics['features']={k:len(records[k]) for k in ['fans','secondary_scars','steps','pits','retouch','inclusions']}
    metrics['secondary_length_mm']=[min(s['length'] for s in records['secondary_scars']),max(s['length'] for s in records['secondary_scars'])]
    metrics['ripple_spacing_mm']=[min(s['spacing'] for s in records['fans']),max(s['spacing'] for s in records['fans'])]
    # Round-two protections: changed encoding is compared in physical units.
    archive=OUT/'round1'
    baseline=json.loads((archive/'baseline.json').read_text())
    changed_archive=[name for name,digest in baseline['sha256'].items() if hashlib.sha256((archive/name).read_bytes()).hexdigest()!=digest]
    require(not changed_archive,'all archived round-one maps, sources, scripts and previews are unchanged')
    old={n:np.array(Image.open(archive/f'{n}.png')) for n in names}
    old_h=old['stone_height'].astype(np.float64)/65535*1.5
    old_fields=np.load(archive/'source/construction_fields.npz')
    edit=fields['face_edit_mask']
    protected=edit==0
    preservation={}
    for size,current in [(2048,maps),(1024,small)]:
        protect=protected if size==2048 else area_half(edit)==0
        old_set=old if size==2048 else {n:np.array(Image.open(archive/f'{n}_1024.png')) for n in names}
        values={}
        for name in ['stone_base','flint_base','stone_orm','flint_orm']:
            error=np.abs(current[name].astype(int)-old_set[name].astype(int))[protect]
            values[name+'_max_byte_error']=int(error.max())
            require(error.max()==0,f'{size}: protected bands and margins in {name} are byte-identical to round one')
        now_h=current['stone_height'].astype(np.float64)/65535*HEIGHT_MM
        past_h=old_set['stone_height'].astype(np.float64)/65535*1.5
        hd=np.abs(now_h-past_h-.57)[protect]
        values['height_after_constant_offset_max_error_mm']=float(hd.max())
        require(hd.max()<.00006,f'{size}: protected physical height profile is unchanged within encoding precision')
        nd=np.abs(current['stone_normal'].astype(int)-old_set['stone_normal'].astype(int))[protect]
        values['normal_max_byte_error']=int(nd.max())
        values['normal_changed_channel_fraction']=float(np.count_nonzero(nd)/nd.size)
        require(nd.max()<=1,f'{size}: protected normal changes by at most one encoding level')
        preservation[str(size)]=values
    for field in ['edge_mask','cortex_mask','face_mask','crown_mask','cortex_mm','retouch_mm','pits_mm','inclusion_mm','grain_mm']:
        require(np.array_equal(fields[field],old_fields[field]),f'round-one {field} source is unchanged')
    region=np.s_[615:1956,:]
    nh,nv=independent_normal(h)
    oh,ov=independent_normal(old_h)
    new_tilt=np.degrees(np.arccos(np.clip(nv[:,:,2],-1,1)))
    old_tilt=np.degrees(np.arccos(np.clip(ov[:,:,2],-1,1)))
    face_stats={}
    for tag,hh,tt in [('round1',old_h,old_tilt),('round2',h,new_tilt)]:
        heights=hh[region]
        face_stats[tag]={'height_min_max_mm':[float(heights.min()),float(heights.max())],
                         'height_p01_p99_mm':np.percentile(heights,[1,99]).tolist(),
                         'height_std_mm':float(heights.std()),'normal_tilt_p50_p95_deg':np.percentile(tt[region],[50,95]).tolist()}
    span1=np.diff(face_stats['round1']['height_p01_p99_mm'])[0]
    span2=np.diff(face_stats['round2']['height_p01_p99_mm'])[0]
    require(span2>span1*3,'face height p01-p99 span increased by more than 3x')
    require(face_stats['round2']['normal_tilt_p50_p95_deg'][1]>face_stats['round1']['normal_tilt_p50_p95_deg'][1]*2.5,'face normal p95 tilt increased by more than 2.5x')
    crests=fields['ripple_crests']
    green=maps['flint_orm'][:,:,1]/255.
    interior=edit>.999
    high=float(green[(crests>.65)&interior].mean())
    low=float(green[(crests<.1)&interior].mean())
    require(low-high>.02,'flint ripple crests are measurably glossier than troughs')
    face_records=records['round2_face']
    pulse_intervals=[v for fan in face_records['fans'] for v in fan['pulse_intervals_mm']]
    require(min(pulse_intervals)>=2 and max(pulse_intervals)<=6,'individual pressure-pulse spacings are within 2-6 mm')
    require(all(v['origin_offset']>v['half_width'] for v in face_records['fans']),'percussion origins sit outside their scar footprints')
    metrics['round2']={'protected_regions':preservation,'face_relief':face_stats,'height_span_ratio':float(span2/span1),
                       'flint_roughness_crest_mean':high,'flint_roughness_trough_mean':low,
                       'fans':len(face_records['fans']),'secondary_scars':len(face_records['secondary_scars']),
                       'hinges':len(face_records['hinges']),
                       'ripple_spacing_mm':[min(v['spacing'] for v in face_records['fans']),max(v['spacing'] for v in face_records['fans'])],
                       'individual_pulse_spacing_mm':[min(pulse_intervals),max(pulse_intervals)],
                       'secondary_length_mm':[min(v['length'] for v in face_records['secondary_scars']),max(v['length'] for v in face_records['secondary_scars'])]}
    (OUT/'metrics.json').write_text(json.dumps(metrics,indent=2)+'\n')
    print('Numerical checks complete; rendering diagnostic sheets.',flush=True)

    # Layer comparisons, full-resolution offsets, and native repeat strips.
    height_display=rgb(h/HEIGHT_MM*255)
    panels=[('stone / unlit sRGB',rgb(maps['stone_base'])),('flint / unlit sRGB',rgb(maps['flint_base'])),
            ('shared height / 0 to 2.5 mm',height_display),('shared normal / OpenGL',rgb(maps['stone_normal'])),
            ('stone / ORM linear',rgb(maps['stone_orm'])),('flint / ORM linear',rgb(maps['flint_orm']))]
    layers=panel_sheet(panels,3,(520,520),'KNAPPED STONE  |  aligned maps  |  200 mm tile')
    layers.save(OUT/'layers.png')
    offset_panels=[]
    for name in names:
        a=maps[name]
        if 'height' in name:
            a=a/65535*255
        a=np.roll(a,(1024,1024),(0,1))
        im=rgb(a)
        im.save(OUT/f'offset_{name}.png')
        offset_panels.append((name+' / half offset',im))
    offset=panel_sheet(offset_panels,3,(520,520),'HALF-TILE OFFSET  |  inspect centre cross')
    offset.save(OUT/'offset.png')
    tiled_panels=[]
    for color in ['stone','flint']:
        # Full native 6144 repeat is retained; contact sheet uses a filtered view.
        tiled=rgb(np.tile(maps[f'{color}_base'],(3,3,1)))
        tiled.save(OUT/f'tiled3x3_{color}_native.png')
        tiled_panels.append((color+' / 3 x 3 unlit',tiled))
    tiled_sheet=panel_sheet(tiled_panels,2,(690,690),'REPEAT REVIEW  |  bands are intentional UV regions')
    tiled_sheet.save(OUT/'tiled3x3.png')

    lights=[(-.63,.40,.66),(.58,-.44,.69)]
    lit={}
    lit_panels=[]
    for color in ['stone','flint']:
        base=maps[f'{color}_base'].astype(np.float32)
        n=maps['stone_normal'].astype(np.float32)/127.5-1
        orm=maps[f'{color}_orm'].astype(np.float32)/255
        for j,l in enumerate(lights):
            result=rgb(shade(base,n,orm[:,:,1],orm[:,:,0],l))
            result.save(OUT/f'{color}_lit_{j+1}.png')
            lit[color,j]=result
            lit_panels.append((f'{color} / light {j+1}',result))
    lit_sheet=panel_sheet(lit_panels,2,(700,700),'TWO LIGHT DIRECTIONS  |  physical normals + dielectric GGX')
    lit_sheet.save(OUT/'relit.png')
    repeat_join=[]
    for color in ['stone','flint']:
        for label,a in [('unlit',maps[f'{color}_base']),('light 1',np.asarray(lit[color,0]))]:
            crop=np.concatenate((a[790:1302,-256:],a[790:1302,:256]),axis=1)
            repeat_join.append((f'{color} / x wrap / {label}',rgb(crop)))
    panel_sheet(repeat_join,2,(512,512),'NATIVE X REPEAT JOIN  |  seam at the centre of each crop').save(OUT/'native_repeat_join.png')
    # Include full native seam bands around each wrap and the material transitions.
    seam_panels=[]
    for color in ['stone','flint']:
        a=np.asarray(lit[color,0])
        for row,label in [(0,'top-bottom wrap'),(256,'edge to cortex'),(512,'cortex to face')]:
            crop=a[np.arange(row-96,row+96)%2048,400:1104]
            seam_panels.append((f'{color} / {label} / native pixels',rgb(crop)))
    seams=panel_sheet(seam_panels,2,(716,192),'NATIVE BOUNDARY STRIPS  |  same light and exposure')
    seams.save(OUT/'seam_strips.png')

    crop=(900,1050,1412,1562)
    native=[]
    for color in ['stone','flint']:
        native += [(color+' / unlit, 50 x 50 mm',rgb(maps[f'{color}_base']).crop(crop)),
                   (color+' / light 1',lit[color,0].crop(crop)),
                   (color+' / light 2',lit[color,1].crop(crop))]
    native_sheet=panel_sheet(native,3,(512,512),'NATIVE FACE DETAIL  |  one image pixel per texture pixel')
    native_sheet.save(OUT/'native_detail.png')
    # Full micro-layer alignment: physically shared scar positions and small flaws.
    cp=(1100,64,1612,576)
    align=[]
    for name in names:
        a=maps[name]
        if 'height' in name:
            a=a/65535*255
        align.append((name+' / edge + cortex + face',rgb(a).crop(cp)))
    alignment=panel_sheet(align,3,(512,512),'NATIVE ALIGNMENT  |  all maps at the same coordinates')
    alignment.save(OUT/'alignment.png')
    # Band profiles give exact row positions independently of the appearance sheet.
    profile=Image.new('RGB',(1200,600),(25,28,32))
    d=ImageDraw.Draw(profile)
    d.text((24,15),'ROW LAYOUT  |  measured masks and sRGB luminance',font=font(23),fill='white')
    for row,label in [(0,'0 / wrap'),(256,'256 / 1/8'),(512,'512 / 1/4'),(2048,'2048 / wrap')]:
        xx=90+row/2048*1030
        d.line((xx,70,xx,520),fill=(82,87,94),width=1)
        d.text((xx-25,535),label,font=font(15),fill=(220,222,220))
    profiles=[(edge_profile,(190,219,242),'edge mask'),(cortex_profile,(225,197,145),'cortex mask'),
              (maps['stone_base'].mean((1,2))/255,(162,166,160),'stone luminance'),
              (maps['flint_base'].mean((1,2))/255,(143,141,180),'flint luminance')]
    for j,(v,c,label) in enumerate(profiles):
        pts=[(90+i/2048*1030,520-float(t)*430) for i,t in enumerate(v)]
        d.line(pts,fill=c,width=2)
        d.text((180+j*230,62),label,font=font(17),fill=c)
    profile.save(OUT/'band_layout.png')

    # Real flat triangles with independent UV regions and a pale edge strip.
    write_mesh()
    blades=[]
    icon_rows=[]
    for color in ['stone','flint']:
        b=maps[f'{color}_base'].astype(np.float32)
        n=maps['stone_normal'].astype(np.float32)
        orm=maps[f'{color}_orm'].astype(np.float32)
        for j,l in enumerate(lights):
            im=render_blade(b,n,orm,l,640)
            im.save(OUT/f'{color}_hatchet_light{j+1}.png')
            blades.append((f'{color} / faceted blade / light {j+1}',im))
        unlit=render_blade(b,n,orm,lights[0],640,True)
        unlit.save(OUT/f'{color}_hatchet_unlit.png')
        blades.append((color+' / unlit UV palette',unlit))
        hero=Image.open(OUT/f'{color}_hatchet_light1.png')
        icon_rows.append((color,hero))
    blade_sheet=panel_sheet(blades,3,(640,640),'HATCHET UV TEST  |  flat facets / face, cortex and edge regions')
    blade_sheet.save(OUT/'hatchet_facets.png')
    comparisons=[]
    for color in ['stone','flint']:
        for j in range(2):
            for tag,folder in [('round 1',archive/'checks'),('round 2',OUT)]:
                comparisons.append((f'{color} / {tag} / light {j+1}',Image.open(folder/f'{color}_hatchet_light{j+1}.png')))
    before_after=panel_sheet(comparisons,4,(480,480),'SAME MESH, UVs, LIGHTS AND EXPOSURE  |  round 1 / round 2')
    before_after.save(OUT/'round_comparison.png')

    # Individual facets at actual screen sizes, using identical UV crops in each
    # round. These complement the deliberately small whole-head icon tests.
    facet_sheets=[]
    samples=[(20,100,(250,1120)),(40,175,(930,980)),(80,250,(680,620))]
    for color in ['stone','flint']:
        sheet=Image.new('RGB',(1250,720),(24,27,31))
        d=ImageDraw.Draw(sheet)
        d.text((18,15),f'{color.upper()}  |  individual facets at 100, 175 and 250 pixels',font=font(22),fill='white')
        for j in range(2):
            py=85+j*310
            d.text((18,py-28),f'Light {j+1}',font=font(16),fill=(220,222,224))
            px=18
            for mm,pixels,(sx,sy) in samples:
                extent=int(round(mm/200*2048))
                for tag,folder in [('round 1',archive/'checks'),('round 2',OUT)]:
                    src=Image.open(folder/f'{color}_lit_{j+1}.png')
                    im=src.crop((sx,sy,sx+extent,sy+extent)).resize((pixels,pixels),RESAMPLE)
                    mask=Image.new('L',(pixels,pixels),0)
                    md=ImageDraw.Draw(mask)
                    md.polygon([(0,int(.22*pixels)),(int(.20*pixels),0),(int(.84*pixels),0),
                                (pixels,int(.17*pixels)),(int(.93*pixels),int(.83*pixels)),(int(.72*pixels),pixels),
                                (int(.07*pixels),int(.91*pixels))],fill=255)
                    sheet.paste(im,(px,py),mask)
                    d.text((px,py+pixels+9),tag,font=font(14),fill=(224,226,224))
                    d.text((px,py+pixels+29),f'{pixels} px / {mm} mm',font=font(12),fill=(160,167,171))
                    px+=pixels+16
                px+=10
        sheet.save(OUT/f'facet_screen_sizes_{color}.png')
        facet_sheets.append((color+' / individual facet comparison',sheet))
    facets=panel_sheet(facet_sheets,1,(1250,720),'ARM-LENGTH FACE READ  |  fixed scale and lighting')
    facets.save(OUT/'facet_screen_sizes.png')
    icons=Image.new('RGB',(1250,680),(24,27,31))
    d=ImageDraw.Draw(icons)
    d.text((20,18),'SCREEN-SIZE REVIEW  |  fixed exposure, same geometry',font=font(24),fill='white')
    for j,(color,im) in enumerate(icon_rows):
        y=78+j*294
        d.text((20,y+10),color,font=font(21),fill='white')
        for k,size in enumerate([250,150,100,64]):
            x=[130,450,700,900][k]
            icon=im.resize((size,size),RESAMPLE)
            icons.paste(icon,(x,y))
            d.text((x,y+size+12),f'{size} px frame',font=font(17),fill=(220,222,220))
        # The installed Pillow's nearest resize fails; exact integer repetition
        # has the same result and is independent of that optional C path.
        mini=np.asarray(im.resize((64,64),RESAMPLE))
        enlarged=rgb(np.repeat(np.repeat(mini,3,axis=0),3,axis=1))
        icons.paste(enlarged,(1030,y))
        d.text((1030,y+205),'64 px, 3x zoom',font=font(16),fill=(220,222,220))
    icons.save(OUT/'screen_sizes.png')

    # Neutral height-only light response prevents albedo from hiding a bad normal.
    nn=maps['stone_normal'].astype(np.float32)/127.5-1
    neutral=[]
    for j,l in enumerate(lights):
        im=rgb(shade(np.full_like(nn,128),nn,np.full(h.shape,.42),np.ones(h.shape),l))
        neutral.append((f'neutral relief / light {j+1}',im.crop(crop)))
    panel_sheet(neutral,2,(512,512),'HEIGHT-ONLY RELIEF  |  constant colour and roughness').save(OUT/'neutral_relief.png')
    thumbs=[('round 1 vs round 2 / identical blade renders',before_after),('individual 100-250 px facets / both lights',facets),
            ('UV test / flat mesh facets',blade_sheet),('screen sizes / 64 to 250 px',icons),
            ('aligned production maps',layers),('two light directions',lit_sheet),
            ('half tile offsets',offset),('3 x 3 repetition',tiled_sheet),
            ('native face detail',native_sheet),('band positions',profile),
            ('native transition strips',seams),('native map alignment',alignment)]
    panel_sheet(thumbs,2,(800,565),'STONE + FLINT  |  material review  |  2048 native / 0.20 m').save(OUT/'contact_sheet.png')
    metrics['check_seconds']=round(time.monotonic()-start,3)
    metrics['passed']=all(item['passed'] for item in metrics['assertions'])
    (OUT/'metrics.json').write_text(json.dumps(metrics,indent=2)+'\n')
    failed=[item['check'] for item in metrics['assertions'] if not item['passed']]
    print(json.dumps({'passed':metrics['passed'],'failed':failed,'normal':metrics['normal'],
                      'downsample':metrics['downsample'],'regions':metrics['regions'],
                      'seconds':metrics['check_seconds']},indent=2),flush=True)
    if failed:
        raise SystemExit(1)


if __name__=='__main__':
    check()
