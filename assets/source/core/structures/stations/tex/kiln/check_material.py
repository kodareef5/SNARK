#!/usr/bin/env python3
"""Independent PNG/physical checks and a small linear-light software renderer."""
from pathlib import Path
import json, time, hashlib, struct
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy.ndimage import map_coordinates, gaussian_filter, distance_transform_edt

ROOT=Path(__file__).resolve().parent
CHECK=ROOT/'checks'
CHECK.mkdir(exist_ok=True)
FONT_PATH='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
def font(n=21):
    try:return ImageFont.truetype(FONT_PATH,n)
    except OSError:return ImageFont.load_default()
def to_img(a):
    return Image.fromarray(np.uint8(np.rint(a).clip(0,255)))
def label(im,title):
    out=Image.new('RGB',(im.width,im.height+38),(26,28,29))
    out.paste(im,(0,38));ImageDraw.Draw(out).text((12,8),title,font=font(18),fill=(227,224,213))
    return out
def sheet(ims,cols=2,bg=(26,28,29)):
    w=max(i.width for i in ims);h=max(i.height for i in ims)
    out=Image.new('RGB',(cols*w,((len(ims)+cols-1)//cols)*h),bg)
    for j,im in enumerate(ims):out.paste(im,((j%cols)*w,(j//cols)*h))
    return out
def srgb_to_linear(x):
    x=x/255.;return np.where(x<=.04045,x/12.92,((x+.055)/1.055)**2.4)
def linear_to_srgb(x):
    x=np.maximum(x,0);return 255*np.where(x<=.0031308,12.92*x,1.055*x**(1/2.4)-.055)
def unit(a):
    return a/np.maximum(np.linalg.norm(a,axis=-1,keepdims=True),1e-12)
def psnr(a,b,peak=255):
    mse=np.mean((a.astype(np.float64)-b.astype(np.float64))**2)
    return 999. if mse==0 else float(10*np.log10(peak**2/mse))
def independent_normal(h):
    # Explicit periodic neighbors, independent of build_material's implementation.
    xp=np.concatenate([h[:,1:],h[:,:1]],1)
    xm=np.concatenate([h[:,-1:],h[:,:-1]],1)
    yp=np.concatenate([h[1:],h[:1]],0)
    ym=np.concatenate([h[-1:],h[:-1]],0)
    step=2000/h.shape[0]
    return unit(np.dstack([-(xp-xm)/(2*step),(yp-ym)/(2*step),np.ones_like(h)]))
def png_header(path):
    raw=path.read_bytes();w,h,depth,kind=struct.unpack('>IIBB',raw[16:26])
    pos=8;chunks=[]
    while pos<len(raw):
        count=struct.unpack('>I',raw[pos:pos+4])[0]
        chunks.append(raw[pos+4:pos+8].decode('ascii'));pos+=12+count
    return dict(width=w,height=h,bit_depth=depth,color_type=kind,chunks=chunks)

def shade(base,n,orm,light,view):
    """One white sun, plain cool-neutral sky, dielectric GGX, no emitted light."""
    l=unit(np.asarray(light,dtype=np.float64));v=unit(np.asarray(view,dtype=np.float64))
    ndl=np.maximum(np.sum(n*l,-1),0)
    ndv=np.maximum(np.sum(n*v,-1),.001)
    halfv=unit(l+v);ndh=np.maximum(np.sum(n*halfv,-1),0)
    vdh=np.maximum(np.sum(v*halfv,-1),0)
    rough=orm[...,1]/255.;ao=orm[...,0]/255.
    alpha=np.maximum(rough**2,.02);a2=alpha**2
    distribution=a2/(np.pi*(ndh**2*(a2-1)+1)**2)
    k=(rough+1)**2/8
    geometry=(ndl/(ndl*(1-k)+k))*(ndv/(ndv*(1-k)+k))
    fresnel=.04+.96*(1-vdh)**5
    spec=distribution*geometry*fresnel/(4*np.maximum(ndl*ndv,.001))
    sky=np.array([.43,.47,.53])*(.85+.15*np.maximum(n[...,2],0))[...,None]
    diffuse=srgb_to_linear(base)*(sky*ao[...,None]+ndl[...,None]*np.array([.85,.81,.75]))
    return linear_to_srgb(diffuse+spec[...,None]*ndl[...,None]*.6)

def render_scene(base,normal,orm,light,size=(1000,850),show_pot=True,face_span=None,pot_only=False):
    """Triangle rasterization with actual tangent frames, UVs and z-buffer.

    Diagnostic geometry: 8-sided squat body, front arched mouth and clay lip,
    tapered shoulder, narrow chimney and clay cap, open lathed crucible.
    Physical texel density by default; face_span=.6 stress-tests the stated UV reuse.
    """
    W,H=size
    base=base.astype(np.float32);normal=normal.astype(np.float32);orm=orm.astype(np.float32)
    eye=np.array([2.7,-4.4,2.8]);target=np.array([.12,0,.62])
    if pot_only:eye=np.array([1.4,-2.4,1.6]);target=np.array([.70,.07,.25])
    forward=unit(target-eye);right=unit(np.cross(forward,[0,0,1]));up=np.cross(right,forward)
    scale=min(W/2.35,H/1.8)
    if pot_only:scale=min(W/.50,H/.60)
    physical_span=.62*np.sin(np.pi/8)
    if face_span is None:face_span=physical_span
    buffer=np.full((H,W),np.inf)
    canvas=np.full((H,W,3),[.115,.125,.135])
    tris=[]
    def tri(p,uv,mat='stone',smooth_norm=None):
        tris.append((np.array(p,float),np.array(uv,float),mat,smooth_norm))
    def quad(p,uv,mat='stone',norms=None):
        tri([p[0],p[1],p[2]],[uv[0],uv[1],uv[2]],mat,None if norms is None else np.asarray(norms)[[0,1,2]])
        tri([p[0],p[2],p[3]],[uv[0],uv[2],uv[3]],mat,None if norms is None else np.asarray(norms)[[0,2,3]])
    def ring(cx,cy,r,z):
        theta=np.linspace(0,2*np.pi,9)-np.pi/2-np.pi/8
        return np.stack([cx+r*np.cos(theta),cy+r*np.sin(theta),np.full(9,z)],-1)
    center=(-.28,0)
    rings=[ring(*center,r,z) for r,z in [(.62,.04),(.62,.78),(.40,1.02),(.17,1.02),(.17,1.43),(.205,1.43),(.205,1.48)]]
    for k in range(len(rings)-1):
        if k==2: # top shoulder horizontal closing annulus
            pass
        for j in range(8):
            if k==0 and j==0:continue # hole and arch modelled below
            lo,hi=rings[k],rings[k+1]
            p=[lo[j],lo[j+1],hi[j+1],hi[j]]
            if k>=4:
                uv=[[j*.12,.98],[(j+1)*.12,.98],[(j+1)*.12,.80],[j*.12,.80]];mat='clay'
            elif k==3:
                uv=[[.18+j*.065,.61],[.18+(j+1)*.065,.61],[.18+(j+1)*.065,.40],[.18+j*.065,.40]];mat='stone'
            elif k==2:
                uv=[[(point[0]+1)/2,.30+point[1]/2] for point in p];mat='stone'
            else:
                zlo=lo[j,2];zhi=hi[j,2]
                uv=[[j*face_span+.11,.72-zlo/2],[(j+1)*face_span+.11,.72-zlo/2],[(j+1)*face_span+.11,.72-zhi/2],[j*face_span+.11,.72-zhi/2]];mat='stone'
            quad(p,uv,mat)
    # Close the front face around a centred arched mouth, with clay ring.
    front_y=rings[0][0,1]-.001
    xmid=center[0];left=rings[0][0,0];rightx=rings[0][1,0]
    # The front face is the segment between vertices 0 and 1; x increases along it.
    xlo,xhi=sorted([left,rightx]);rad=.185;spring=.31;bottom=.11
    arch=[(xmid-rad,bottom),(xmid-rad,spring)]
    arch += [(xmid+rad*np.cos(t),spring+rad*np.sin(t)) for t in np.linspace(np.pi,0,21)[1:]]
    arch += [(xmid+rad,bottom)]
    for side in [-1,1]:
        a=xlo if side<0 else xmid+rad+.028;b=xmid-rad-.028 if side<0 else xhi
        p=[[a,front_y,.04],[b,front_y,.04],[b,front_y,.78],[a,front_y,.78]]
        uv=[[(a-xlo)/(xhi-xlo)*face_span+.11,.70],[(b-xlo)/(xhi-xlo)*face_span+.11,.70],[(b-xlo)/(xhi-xlo)*face_span+.11,.33],[(a-xlo)/(xhi-xlo)*face_span+.11,.33]]
        quad(p,uv)
    for i in range(1,len(arch)-2):
        a=np.array(arch[i]);b=np.array(arch[i+1])
        na=unit(a-[xmid,spring]);nb=unit(b-[xmid,spring]);oa=a+na*.028;ob=b+nb*.028
        quad([[oa[0],front_y,oa[1]],[ob[0],front_y,ob[1]],[ob[0],front_y,.78],[oa[0],front_y,.78]],
             [[.11+(oa[0]-xlo)/(xhi-xlo)*face_span,.72-oa[1]/2],[.11+(ob[0]-xlo)/(xhi-xlo)*face_span,.72-ob[1]/2],[.11+(ob[0]-xlo)/(xhi-xlo)*face_span,.33],[.11+(oa[0]-xlo)/(xhi-xlo)*face_span,.33]])
    # Warm smoothed arch and lower sill.
    for i in range(len(arch)-1):
        a=np.array(arch[i]);b=np.array(arch[i+1]);mid=(a+b)/2
        if i==0:off=np.array([-.028,0])
        elif i==len(arch)-2:off=np.array([.028,0])
        else:off=unit(mid-[xmid,spring])*.028
        oa=a+off;ob=b+off
        quad([[a[0],front_y-.008,a[1]],[b[0],front_y-.008,b[1]],[ob[0],front_y-.008,ob[1]],[oa[0],front_y-.008,oa[1]]],[[i*.035,.86],[(i+1)*.035,.86],[(i+1)*.035,.88],[i*.035,.88]],'clay')
    quad([[xmid-rad-.028,front_y,.04],[xmid+rad+.028,front_y,.04],[xmid+rad+.028,front_y,.11],[xmid-rad-.028,front_y,.11]],[[.1,.94],[.48,.94],[.48,.91],[.1,.91]],'clay')
    for i in range(len(arch)-1):
        tri([[xmid,front_y+.025,.24],[arch[i][0],front_y+.025,arch[i][1]],[arch[i+1][0],front_y+.025,arch[i+1][1]]],[[0,0]]*3,'black')
    # Flat orange geometry. It receives exactly the same sun and sky, no glow.
    for x,z,w,h in [(xmid-.10,.13,.06,.18),(xmid-.02,.13,.07,.24),(xmid+.075,.13,.055,.16)]:
        tri([[x-w,front_y+.012,z],[x+w,front_y+.012,z],[x+.02,front_y+.012,z+h]],[[0,0]]*3,'fire')
    if show_pot:
        cx,cy=.70,.07
        # A separate diagnostic crucible: about 0.8m circumference at the lip.
        from scipy.interpolate import PchipInterpolator
        z=np.linspace(.04,.43,27)
        r=PchipInterpolator([.04,.09,.20,.32,.43],[.07,.095,.125,.132,.122])(z)
        profile=list(zip(r,z))+[(.127,.44),(.127,.45),(.111,.45),(.106,.41),(.110,.22),(.08,.12),(.0,.12)]
        rz=np.asarray(profile)
        tangents=np.gradient(rz,axis=0)
        segments=56
        for k in range(len(profile)-1):
            r0,z0=profile[k];r1,z1=profile[k+1]
            for j in range(segments):
                a,b=j/segments*2*np.pi,(j+1)/segments*2*np.pi
                p=[[cx+r0*np.cos(a),cy+r0*np.sin(a),z0],[cx+r0*np.cos(b),cy+r0*np.sin(b),z0],[cx+r1*np.cos(b),cy+r1*np.sin(b),z1],[cx+r1*np.cos(a),cy+r1*np.sin(a),z1]]
                uv=[[.41+j/segments*.40,.99-z0/2],[.41+(j+1)/segments*.40,.99-z0/2],[.41+(j+1)/segments*.40,.99-z1/2],[.41+j/segments*.40,.99-z1/2]]
                def pn(index,theta):
                    dr,dz=tangents[index]
                    return unit(np.array([dz*np.cos(theta),dz*np.sin(theta),-dr]))
                quad(p,uv,'clay',[pn(k,a),pn(k,b),pn(k+1,b),pn(k+1,a)])
    if pot_only:tris=[t for t in tris if np.min(t[0][:,0])>.4]
    # Neutral floor, deliberately no artificial orange lighting.
    quad([[-2,-2,0],[2,-2,0],[2,2,0],[-2,2,0]],[[0,0]]*4,'floor')
    texsize=base.shape[0]
    def sample(tex,u,v):
        coords=[(v%1)*texsize-.5,(u%1)*texsize-.5]
        return np.stack([map_coordinates(tex[...,i],coords,order=1,mode='grid-wrap') for i in range(3)],-1)
    for p,uv,mat,smooth_norm in tris:
        e1=p[1]-p[0];e2=p[2]-p[0];ng=unit(np.cross(e1,e2))
        if np.linalg.norm(ng)<.5:continue
        # Keep two-sided diagnostic geometry while preserving outward tangent orientation.
        camera_vec=unit(eye-p.mean(0))
        if np.dot(ng,camera_vec)<0:ng=-ng
        relative=p-target
        q=np.stack([W/2+(relative@right)*scale,H/2-(relative@up)*scale],-1)
        depth=(p-eye)@forward
        x0=max(0,int(np.floor(q[:,0].min())));x1=min(W,int(np.ceil(q[:,0].max()))+1)
        y0=max(0,int(np.floor(q[:,1].min())));y1=min(H,int(np.ceil(q[:,1].max()))+1)
        if x1<=x0 or y1<=y0:continue
        py,px=np.mgrid[y0:y1,x0:x1];px=px+.5;py=py+.5
        den=(q[1,1]-q[2,1])*(q[0,0]-q[2,0])+(q[2,0]-q[1,0])*(q[0,1]-q[2,1])
        if abs(den)<1e-8:continue
        a=((q[1,1]-q[2,1])*(px-q[2,0])+(q[2,0]-q[1,0])*(py-q[2,1]))/den
        b=((q[2,1]-q[0,1])*(px-q[2,0])+(q[0,0]-q[2,0])*(py-q[2,1]))/den
        c=1-a-b;d=a*depth[0]+b*depth[1]+c*depth[2]
        mask=(a>=-1e-6)&(b>=-1e-6)&(c>=-1e-6)&(d<buffer[y0:y1,x0:x1])
        if not mask.any():continue
        u=a[mask]*uv[0,0]+b[mask]*uv[1,0]+c[mask]*uv[2,0]
        v=a[mask]*uv[0,1]+b[mask]*uv[1,1]+c[mask]*uv[2,1]
        if mat in ('stone','clay'):
            color=sample(base,u,v);o=sample(orm,u,v);nt=unit(sample(normal,u,v)/127.5-1)
            ngp=ng
            if smooth_norm is not None:
                ngp=unit(a[mask,None]*smooth_norm[0]+b[mask,None]*smooth_norm[1]+c[mask,None]*smooth_norm[2])
                if np.dot(ngp.mean(0),ng)<0:ngp=-ngp
            du1,dv1=uv[1]-uv[0];du2,dv2=uv[2]-uv[0];det=du1*dv2-du2*dv1
            if abs(det)>1e-8:
                t0=unit((e1*dv2-e2*dv1)/det);t=unit(t0-ngp*np.sum(t0*ngp,axis=-1,keepdims=True))
                b0=unit(-(e2*du1-e1*du2)/det)
                handed=1 if np.dot(np.cross(ng,t0),b0)>=0 else -1
                by=unit(np.cross(ngp,t))*handed
                n=unit(nt[:,0,None]*t+nt[:,1,None]*by+nt[:,2,None]*ngp)
            else:n=np.broadcast_to(ng,color.shape)
        else:
            rgb={'black':[26,21,18],'fire':[235,104,26],'floor':[109,109,102]}[mat]
            color=np.broadcast_to(rgb,(len(u),3));o=np.broadcast_to([255,242,0],color.shape);n=np.broadcast_to(ng,color.shape)
        rgb=shade(color,n,o,light,camera_vec)
        canvas[y0:y1,x0:x1][mask]=srgb_to_linear(np.clip(rgb,0,255))
        buffer[y0:y1,x0:x1][mask]=d[mask]
    out=to_img(linear_to_srgb(canvas))
    draw=ImageDraw.Draw(out)
    for k,(name,color) in enumerate([('kiln',(96,86,76)),('boards',(172,128,82)),('iron',(44,41,39)),('limestone',(156,150,138))] if not pot_only else []):
        x=18+k*145;draw.rectangle((x,H-59,x+126,H-33),fill=color);draw.text((x,H-27),name,fill=(224,224,215),font=font(14))
    return out

def run():
    start=time.perf_counter();results={};assertions=[]
    def check(name,ok):
        assertions.append((name,bool(ok)))
    maps={}
    for res,suffix in [(2048,''),(1024,'_1024')]:
        for kind in ['base','height','normal','orm']:
            path=ROOT/f'kiln_{kind}{suffix}.png';a=np.asarray(Image.open(path));maps[(res,kind)]=a
            hdr=png_header(path);results[path.name]=hdr
            check(path.name+' dimensions',a.shape[:2]==(res,res))
            check(path.name+' PNG bit depth/type',hdr['bit_depth']==(16 if kind=='height' else 8) and hdr['color_type']==(0 if kind=='height' else 2))
            check(path.name+' colour encoding',('sRGB' in hdr['chunks']) if kind=='base' else not any(c in hdr['chunks'] for c in ['sRGB','gAMA','iCCP']))
        h=maps[res,'height'].astype(float)*40/65535
        n=independent_normal(h);encoded=np.rint((n*.5+.5)*255).astype(np.uint8)
        normal=maps[res,'normal'];delta=np.abs(encoded.astype(int)-normal.astype(int))
        angle=np.rad2deg(np.arccos(np.clip(np.sum(n*unit(normal/127.5-1),-1),-1,1)))
        results[f'normal_{res}']=dict(max_channel_error=int(delta.max()),mismatched_channels=int(np.count_nonzero(delta)),angle_mean=float(angle.mean()),angle_max=float(angle.max()))
        check(f'{res} physical normal agreement',delta.max()<=1 and angle.max()<.40)
        check(f'{res} zero metalness',np.all(maps[res,'orm'][...,2]==0))
        check(f'{res} unclipped height',h.min()>0 and h.max()<40)
    base=maps[2048,'base'];normal=maps[2048,'normal'];orm=maps[2048,'orm'];height=maps[2048,'height']
    f=np.load(ROOT/'source/construction_fields.npz')
    stone=(f['stone_mask']>.98)&(f['wall_weight']>.99);joint=(f['stone_mask']<.02)&(f['wall_weight']>.99)
    clay=np.zeros((2048,2048),bool);clay[1536:]=True
    results['palette']={name:base[mask].mean(0).tolist() for name,mask in [('stone',stone),('daub',joint),('clay',clay)]}
    results['palette']['stone_band']=base[:1536].mean((0,1)).tolist()
    results['physical_height_mm']=[float(height.min())*40/65535,float(height.max())*40/65535]
    results['face_minus_daub_mm']=float(height[stone].mean()*40/65535-height[joint].mean()*40/65535)
    check('stone band palette',np.max(np.abs(np.array(results['palette']['stone_band'])-[96,86,76]))<8)
    for name,mask,lower,upper in [('stone',stone,.8,1),('daub',joint,.90,1),('fired',clay,.75,.90)]:
        rough=orm[...,1][mask]/255
        results[name+'_roughness']=dict(min=float(rough.min()),max=float(rough.max()),mean=float(rough.mean()))
        check(name+' roughness',rough.min()>=lower-.003 and rough.max()<=upper+.003)
    for name,mask,lower,upper in [('soot',stone&(f['soot']>.7),.90,1),('low_soot_stone',stone&(f['soot']<.2),.80,.95)]:
        values=orm[...,1][mask]/255
        results[name+'_roughness']=dict(min=float(values.min()),max=float(values.max()),mean=float(values.mean()))
        check(name+' roughness',values.min()>=lower-.003 and values.max()<=upper+.003)
    results['ao']={name:float(orm[...,0][mask].mean()/255) for name,mask in [('stone',stone),('daub',joint),('fired',clay)]}
    check('cavity AO is deeper in joints',results['ao']['daub']<results['ao']['stone'])
    check('bands end exactly at row 1536',np.max(f['wall_weight'][1536:])==0)
    check('wrap boundary is all clay',np.max(f['wall_weight'][0])==0)
    reconstructed=gaussian_filter(f['height_unfiltered_mm'],.55,mode='wrap')
    err=np.max(np.abs(reconstructed-height*40./65535))
    results['height_source_max_error_mm']=float(err)
    check('saved height reconstruction',err<=40/65535*.51)
    results['downsizing']={}
    for kind in ['base','height','normal','orm']:
        a=maps[2048,kind].astype(float);b=maps[1024,kind]
        shape=(1024,2,1024,2)+a.shape[2:]
        area=np.rint(a.reshape(shape).mean((1,3)))
        peak=65535 if kind=='height' else 255
        if a.ndim==2:
            lanczos=np.asarray(Image.fromarray(a.astype(np.float32)).resize((1024,1024),Image.Resampling.LANCZOS))
        else:
            lanczos=np.stack([np.asarray(Image.fromarray(a[...,c].astype(np.float32)).resize((1024,1024),Image.Resampling.LANCZOS)) for c in range(3)],-1)
        results['downsizing'][kind]=dict(area_psnr_db=psnr(area,b,peak),lanczos_psnr_db=psnr(lanczos,b,peak),exact_area=bool(np.array_equal(area,b)))
        check(kind+' downsample >30dB',min(psnr(area,b,peak),psnr(lanczos,b,peak))>=30)
    results['seams']={}
    for kind in ['base','height','normal','orm']:
        a=maps[2048,kind].astype(float)
        if kind=='height':a*=40/65535
        dimensions=tuple(range(1,a.ndim))
        xdiff=np.abs(np.diff(a,axis=1));ydiff=np.abs(np.diff(a,axis=0))
        xlines=xdiff.mean(axis=tuple(i for i in range(a.ndim) if i!=1))
        ylines=ydiff.mean(axis=dimensions)
        sx=float(np.abs(a[:,0]-a[:,-1]).mean());sy=float(np.abs(a[0]-a[-1]).mean())
        refx=float(np.percentile(xlines,95));refy=float(np.percentile(ylines,95))
        results['seams'][kind]=dict(x_wrap_mean=sx,y_wrap_mean=sy,x_interior_p95=refx,y_interior_p95=refy)
        check(kind+' x wrap',sx<refx*1.3)
        check(kind+' y wrap',sy<refy*1.3)
    meta=json.loads((ROOT/'source/construction.json').read_text())
    results['stones']=dict(count=meta['stone_count'],heat_split_count=sum(r['heat_split'] for r in meta['stones']),width_mm=[min(r['width_mm'] for r in meta['stones']),max(r['width_mm'] for r in meta['stones'])],height_mm=[min(r['height_mm'] for r in meta['stones']),max(r['height_mm'] for r in meta['stones'])])
    check('physical stone widths',results['stones']['width_mm'][0]>=120 and results['stones']['width_mm'][1]<=300)
    check('physical stone heights',results['stones']['height_mm'][0]>=80 and results['stones']['height_mm'][1]<=180)
    # Closest distinct stones, including wrapped footprints. This catches tipped
    # corners which nominal cell widths alone do not measure.
    ids=f['stone_ids'];separations=[];extents=[]
    for sid in range(1,meta['stone_count']+1):
        ys,xs=np.where(ids==sid)
        if not len(xs):continue
        if xs.max()-xs.min()>1024:
            xs=(xs+1024)%2048;labels=np.roll(ids,1024,1)
        else:labels=ids
        patch=labels[max(0,ys.min()-48):min(2048,ys.max()+49),max(0,xs.min()-48):min(2048,xs.max()+49)]
        others=(patch!=0)&(patch!=sid)
        if others.any():separations.append(float(distance_transform_edt(~others)[patch==sid].min()*2000/2048))
        extents.append([float((xs.max()-xs.min()+1)*2000/2048),float((ys.max()-ys.min()+1)*2000/2048)])
    results['joint_nearest_distance_mm_percentiles']=np.percentile(separations,[0,25,50,75,100]).tolist()
    results['actual_footprint_extents_mm']={'min':np.min(extents,axis=0).tolist(),'max':np.max(extents,axis=0).tolist()}
    check('clay gaps remain at least 15 mm',min(separations)>=15)
    # Native files and compact contact versions, never hiding a seam with annotation.
    displays=[to_img(base),to_img(height/257).convert('RGB'),to_img(normal),to_img(orm)]
    names=['Base / sRGB / unlit','Height / 0-40 mm','Normal / OpenGL / physical scale','ORM / AO, roughness, zero metal']
    layers=sheet([label(im.resize((768,768),Image.Resampling.LANCZOS),name) for im,name in zip(displays,names)],2)
    layers.save(CHECK/'layers.png')
    offsets=[]
    for im,name,kind in zip(displays,names,['base','height','normal','orm']):
        a=np.asarray(im);off=Image.fromarray(np.roll(a,(1024,1024),(0,1)))
        off.save(CHECK/f'offset_{kind}_native.png')
        offsets.append(label(off.resize((768,768),Image.Resampling.LANCZOS),name+' / half offset'))
    offset=sheet(offsets,2);offset.save(CHECK/'offset.png')
    tiled=Image.fromarray(np.tile(base,(3,3,1)));tiled.save(CHECK/'tiled3x3_native.png')
    tiledsmall=tiled.resize((1536,1536),Image.Resampling.LANCZOS);tiledsmall.save(CHECK/'tiled3x3.png')
    # Stone band repeats by itself to inspect the asset away from trim transitions.
    stone_repeat=Image.fromarray(np.tile(base[48:1488],(3,3,1)))
    stone_repeat.resize((1536,1080),Image.Resampling.LANCZOS).save(CHECK/'stone_band_repeat.png')
    n=unit(normal.astype(float)/127.5-1)
    relits=[]
    for tag,light in [('A',[-3,4,5]),('B',[4,-2,3])]:
        lit=to_img(shade(base,n,orm,light,[0,0,1]));lit.save(CHECK/f'relit_{tag}_native.png')
        relits.append(label(lit.resize((768,768),Image.Resampling.LANCZOS),'Sun '+tag+' + plain sky'))
    relit=sheet(relits,2);relit.save(CHECK/'relit.png')
    # 1:1 close views show pigment, the matching normal, and changing light.
    details=[]
    for x,y,title in [(256,360,'Stones and daub'),(1120,1536,'Smoothed fired clay')]:
        for im,desc in [(displays[0],'unlit'),(displays[2],'normal'),(Image.open(CHECK/'relit_A_native.png'),'sun A'),(Image.open(CHECK/'relit_B_native.png'),'sun B')]:
            crop=im.crop((x,y,x+512,y+512));details.append(label(crop,title+' / '+desc))
    detail=sheet(details,4);detail.save(CHECK/'native_detail.png')
    # Exact wrap joins at native scale, and both prescribed horizontal transitions.
    seam_panels=[]
    for im,title in [(displays[0],'base'),(displays[2],'normal')]:
        lr=Image.new('RGB',(384,768));lr.paste(im.crop((1856,256,2048,1024)),(0,0));lr.paste(im.crop((0,256,192,1024)),(192,0))
        seam_panels.append(label(lr,title+' / left-right seam'))
        tb=Image.new('RGB',(768,384));tb.paste(im.crop((640,1856,1408,2048)),(0,0));tb.paste(im.crop((640,0,1408,192)),(0,192))
        seam_panels.append(label(tb,title+' / bottom-top seam'))
        seam_panels.append(label(im.crop((640,1344,1408,1728)),title+' / row 1536'))
    sheet(seam_panels,3).save(CHECK/'native_seam_strips.png')
    # Narrow real-size chimney samples and horizontal course cuts.
    samples=[label(displays[0].crop((x,150,x+287,1430)),f'0.28 m chimney / x={x}') for x in [100,690,1470]]
    strip_sheet=sheet(samples,3);strip_sheet.save(CHECK/'chimney_strips.png')
    scenes=[]
    for tag,light in [('A',[-3,-4,5]),('B',[4,1,3])]:
        sc=render_scene(base,normal,orm,light)
        sc.save(CHECK/f'furnace_{tag}.png');scenes.append(label(sc,'Sun '+tag+' + plain sky / physical 2 m tile scale'))
    model=sheet(scenes,2);model.save(CHECK/'furnace_two_lights.png')
    stress=render_scene(base,normal,orm,[-3,-4,5],face_span=.6)
    label(stress,'UV stress test: 0.6 tile per side compresses stones horizontally').save(CHECK/'furnace_uv_stress.png')
    pots=[]
    for tag,light in [('A',[-3,-4,5]),('B',[4,1,3])]:
        pot=render_scene(base,normal,orm,light,size=(768,900),pot_only=True)
        pots.append(label(pot,'Crucible / sun '+tag+' / same exposure and material'))
    potsheet=sheet(pots,2);potsheet.save(CHECK/'pot_two_lights.png')
    # Independent clay-pot close-up as a lathed cylinder-shaped pot diagnostic.
    # Crop from the same rendered scene, retaining the identical light and exposure.
    inventory=Image.new('RGB',(1000,420),(26,28,29));d=ImageDraw.Draw(inventory)
    crop=Image.open(CHECK/'furnace_A.png').crop((105,0,635,760))
    sc=Image.new('RGB',(800,800),(95,99,102));sc.paste(crop,((800-crop.width)//2,20))
    for j,s in enumerate([64,128,256]):
        small=sc.resize((s,s),Image.Resampling.LANCZOS);small.save(CHECK/f'inventory_{s}.png')
        inventory.paste(small.resize((256,256),Image.Resampling.NEAREST),(30+j*320,50))
        d.text((30+j*320,325),f'{s} px, enlarged nearest',font=font(18),fill='white')
    inventory.save(CHECK/'inventory_sizes.png')
    # Palette patch comparison at the intended colour values.
    palette=Image.new('RGB',(1000,270),(26,28,29));d=ImageDraw.Draw(palette)
    for j,(name,color) in enumerate([('kiln stone',(96,86,76)),('kiln fired',(168,132,100)),('boards',(172,128,82)),('iron',(44,41,39)),('limestone',(156,150,138))]):
        d.rectangle((j*200+10,15,j*200+190,205),fill=color);d.text((j*200+10,220),name,font=font(17),fill='white')
    palette.save(CHECK/'palette.png')
    contacts=[]
    for im,title in [(layers,'Aligned delivery layers'),(offset,'Half-tile wrapped offsets'),(tiledsmall,'3 x 3 full trim'),(detail,'Native surface crops'),(relit,'Opposing sun directions'),(model,'Eight-sided furnace + crucible'),(potsheet,'Fired clay on a curved crucible'),(inventory,'Small-screen readability'),(strip_sheet,'Narrow chimney cuts'),(stress,'UV stress: 0.6 tile width on each octagon face')]:
        thumb=im.copy();thumb.thumbnail((900,650),Image.Resampling.LANCZOS)
        panel=Image.new('RGB',(900,650),(26,28,29));panel.paste(thumb,((900-thumb.width)//2,(650-thumb.height)//2))
        contacts.append(label(panel,title))
    sheet(contacts,2).save(CHECK/'contact_sheet.png')
    results['checks']=[dict(name=k,passed=v) for k,v in assertions]
    results['passed']=sum(v for _,v in assertions);results['failed']=[k for k,v in assertions if not v]
    results['check_seconds']=round(time.perf_counter()-start,3)
    (CHECK/'metrics.json').write_text(json.dumps(results,indent=2)+'\n')
    lines=[('PASS ' if v else 'FAIL ')+k for k,v in assertions]
    (CHECK/'validation.txt').write_text('\n'.join(lines)+f'\n{results["passed"]}/{len(assertions)} passed\n')
    manifest={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(ROOT.glob('kiln_*.png'))}
    (CHECK/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print(json.dumps({k:v for k,v in results.items() if k not in ['checks'] and not k.endswith('.png')},indent=2))
    if results['failed']:raise SystemExit(1)

if __name__=='__main__':run()
