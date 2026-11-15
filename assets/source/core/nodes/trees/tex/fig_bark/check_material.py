#!/usr/bin/env python3
"""Independent delivery checks and shadow-free physical-scale material previews.
Reads the four saved PNGs; never imports the build's normal calculation.
All output is confined to checks/. --rebuild verifies a fresh isolated build.
"""
from pathlib import Path
import hashlib
import json
import struct
import sys
import shutil
import subprocess
import tempfile
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy.ndimage import map_coordinates, gaussian_filter, maximum_filter
ROOT = Path(__file__).resolve().parent
OUT = ROOT/'checks'
OUT.mkdir(exist_ok=True)
C = json.loads((ROOT/'material.json').read_text())
N = 2048
try: FONT = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf',20)
except OSError: FONT = ImageFont.load_default()


def rgb(a):
    if a.ndim == 2:
        if a.dtype == np.uint16: a = a.astype(np.float32)/257
        a = np.repeat(a[...,None],3,-1)
    return Image.fromarray(np.clip(np.rint(a),0,255).astype(np.uint8))


def unit(a): return a/np.maximum(np.linalg.norm(a,axis=-1,keepdims=True),1e-12)


def linear(a):
    a = a/255
    return np.where(a<=.04045,a/12.92,((a+.055)/1.055)**2.4)


def srgb(a):
    a = np.maximum(a,0)
    return np.clip(np.where(a<=.0031308,a*12.92,1.055*a**(1/2.4)-.055)*255,0,255)


def luminance(a): return a[...,0]*.2126+a[...,1]*.7152+a[...,2]*.0722


def sheet(items,filename,cell=(768,768),cols=2):
    cw,ch = cell
    rows = (len(items)+cols-1)//cols
    out = Image.new('RGB',(cw*cols,(ch+42)*rows),'#212526')
    d = ImageDraw.Draw(out)
    for i,(title,im) in enumerate(items):
        x,y = (i%cols)*cw,(i//cols)*(ch+42)
        d.text((x+14,y+10),title,font=FONT,fill='#E3DFD5')
        out.paste(im.resize(cell,Image.Resampling.LANCZOS),(x,y+42))
    out.save(OUT/filename,quality=95,subsampling=0)


def light(base_linear,n,orm,side,view=None):
    """One low sun + uniform sky irradiance. No cast shadow or bounced light.
    AO affects sky only. Normal map affects direct light; roughness drives GGX.
    Values are in linear scene-referred units with fixed exposure for all images.
    """
    elev,az = np.deg2rad([C['preview']['sun_elevation_degrees'],side])
    l = np.array([np.sin(az)*np.cos(elev),np.sin(elev),np.cos(az)*np.cos(elev)],np.float32)
    if view is None: view = np.broadcast_to(np.array([0.,0.,1.]),n.shape)
    half = unit(view+l)
    nl = np.clip(np.sum(n*l,-1),0,1)
    nv = np.clip(np.sum(n*view,-1),.001,1)
    nh = np.clip(np.sum(n*half,-1),0,1)
    vh = np.clip(np.sum(view*half,-1),0,1)
    a2 = orm[...,1]**4
    distribution = a2/(np.pi*(nh*nh*(a2-1)+1)**2+1e-8)
    k = (orm[...,1]+1)**2/8
    geometry = nv/(nv*(1-k)+k)*nl/(nl*(1-k)+k)
    fresnel = .04+.96*(1-vh)**5
    spec = distribution*geometry*fresnel/(4*nv*np.maximum(nl,.001))
    sky = np.array(C['preview']['sky_irradiance_rgb'],np.float32)
    sun = np.array(C['preview']['sun_irradiance_rgb'],np.float32)
    color = base_linear*(sky*orm[...,0,None]+sun*nl[...,None])
    color += spec[...,None]*sun*nl[...,None]*.32
    return color


def seam_stats(a):
    a = a.astype(np.float64)
    if a.ndim == 2: a = a[...,None]/257
    result = {}
    for ax,name in [(1,'left_right'),(0,'top_bottom')]:
        inside = np.abs(np.diff(a,axis=ax))
        seam = np.abs(np.take(a,0,axis=ax)-np.take(a,-1,axis=ax))
        lines = inside.mean(axis=tuple(i for i in range(3) if i!=ax))
        result[name] = {'edge_mean_8bit_equivalent':float(seam.mean()),'interior_mean_8bit_equivalent':float(inside.mean()),
                        'mean_ratio':float(seam.mean()/inside.mean()),'edge_p99':float(np.quantile(seam,.99)),
                        'interior_p99':float(np.quantile(inside,.99)),
                        'edge_percentile_among_interior_lines':float(np.mean(lines<=seam.mean())*100),
                        'interior_line_p95':float(np.quantile(lines,.95))}
    return result


def mipchain(a):
    result = [a.astype(np.float32)]
    while result[-1].shape[0]>16:
        q = result[-1]
        result.append((q[::2,::2]+q[1::2,::2]+q[::2,1::2]+q[1::2,1::2])*.25)
    return result


def sample_mips(chain,u,v,lod):
    lo = np.floor(lod).astype(int)
    frac = lod-lo
    out = np.zeros((*u.shape,3),np.float32)
    for level in range(len(chain)):
        weight = np.where(lo==level,1-frac,0)+np.where(lo+1==level,frac,0)
        active = weight>0
        if not active.any(): continue
        tex = chain[level]; size = tex.shape[0]
        coords = [v[active]*size-.5,u[active]*size-.5]
        for ch in range(3):
            out[...,ch][active] += map_coordinates(tex[...,ch],coords,order=1,mode='grid-wrap')*weight[active]
    return out


def render_scene(chains,kind,distance,side,diameter=1.8):
    """Perspective at 1920x1080, 60deg horizontal FOV. Distances to front face.
    Trilinear mip selection from screen-space UV derivatives. 2x supersampling.
    Cylinder diameter is parameterized, height 4 m, camera eye 1.6 m. No displacement.
    """
    W,H = C['preview']['viewport']; scale = 2
    w,h = W*scale,H*scale
    # Render in horizontal strips to keep working memory under control.
    f = w/(2*np.tan(np.deg2rad(C['preview']['horizontal_fov_degrees'])/2))
    frame = np.empty((h,w,3),np.float32)
    xray = (np.arange(w,dtype=np.float32)+.5-w/2)/f
    for row in range(0,h,128):
        rows = min(128,h-row)
        yray = (h/2-(np.arange(row,row+rows,dtype=np.float32)+.5))/f
        rx,ry = np.broadcast_arrays(xray[None,:],yray[:,None])
        if kind == 'cylinder':
            radius = diameter/2
            centre = distance+radius
            A = rx*rx+1
            disc = centre*centre-A*(centre*centre-radius*radius)
            t = (centre-np.sqrt(np.maximum(disc,0)))/A
            px,pz = rx*t,centre-t
            py = ry*t+1.6
            valid = (disc>0)&(py>=0)&(py<=4)
            phi = np.arctan2(px,pz)
            u = phi*radius/C['width_m']+.371
            v = -py/C['height_m']+.217
        else:
            t = np.full(rx.shape,distance,np.float32)
            px,py = rx*t,ry*t+1.6
            valid = (np.abs(px)<.8)&(py>=0)&(py<=4)
            phi = np.zeros_like(rx)
            u = px/C['width_m']+.371
            v = -py/C['height_m']+.217
        dudx = np.gradient(u,axis=1)*N
        dvdx = np.gradient(v,axis=1)*N
        dudy = np.gradient(u,axis=0)*N
        dvdy = np.gradient(v,axis=0)*N
        footprint = np.maximum(np.hypot(dudx,dvdx),np.hypot(dudy,dvdy))
        lod = np.clip(np.log2(np.maximum(footprint,1)),0,len(chains[0])-1.001)
        b,n,o = [sample_mips(chain,u,v,lod) for chain in chains]
        n = unit(n)
        world = np.stack([np.cos(phi)*n[...,0]+np.sin(phi)*n[...,2],n[...,1],-np.sin(phi)*n[...,0]+np.cos(phi)*n[...,2]],-1)
        view = unit(np.stack([-rx,-ry,np.ones_like(rx)],-1))
        shaded = light(b,world,o,side,view)
        background = np.broadcast_to(np.array([.105,.125,.139],np.float32),shaded.shape).copy()
        background[valid] = shaded[valid]
        frame[row:row+rows] = background
    # Antialias in linear light, then encode sRGB exactly once.
    frame = (frame[::2,::2]+frame[1::2,::2]+frame[::2,1::2]+frame[1::2,1::2])*.25
    im = rgb(srgb(frame))
    draw = ImageDraw.Draw(im)
    label = 'front' if side==0 else 'side'
    width = diameter if kind=='cylinder' else 1.6
    caption = f'{kind.capitalize()} | {distance:g} m to front | {width:g} m wide | sun {label}, 18 deg high'
    draw.rectangle((0,0,W,45),fill='#202627')
    draw.text((18,12),caption,font=FONT,fill='#EAE3D3')
    draw.text((18,H-31),'1920 x 1080 / 60 deg HFOV / uniform sky / no cast shadows / no bounce',font=FONT,fill='#D2D7D4')
    stem = f'cylinder_{diameter:g}m' if kind=='cylinder' else 'flat'
    im.save(OUT/f'{stem}_{distance:g}m_{label}.jpg',quality=96,subsampling=0)
    return im


def region(a,mask):
    x = a[mask]
    return {'mean':np.mean(x,axis=0,dtype=np.float64).tolist(),'median':np.median(x,axis=0).tolist(),
            'p05':np.quantile(x,.05,axis=0).tolist(),'p95':np.quantile(x,.95,axis=0).tolist()}


def main():
    arrays,files={},{}
    for key in ('base','height','normal','orm'):
        p=ROOT/f'fig_bark_{key}.png';raw=p.read_bytes();im=Image.open(p)
        w,h,depth,ctype,_,_,_=struct.unpack('>IIBBBBB',raw[16:29])
        assert (w,h)==(N,N)
        assert (depth,ctype)==((16,0) if key=='height' else (8,2))
        assert ('icc_profile' in im.info)==(key=='base')
        arrays[key]=np.array(im)
        files[key]={'file':p.name,'size':[w,h],'bit_depth':depth,'PNG_color_type':ctype,
                    'sRGB_profile':key=='base','sha256':hashlib.sha256(raw).hexdigest()}
    b,h,n,o=[arrays[key] for key in ('base','height','normal','orm')]
    height=h.astype(np.float64)/65535*C['height_range_mm']/1000
    sx,sy=np.empty_like(height),np.empty_like(height)
    sx[:,1:-1]=height[:,2:]-height[:,:-2]
    sx[:,0]=height[:,1]-height[:,-1];sx[:,-1]=height[:,0]-height[:,-2]
    sy[1:-1]=height[2:]-height[:-2]
    sy[0]=height[1]-height[-1];sy[-1]=height[0]-height[-2]
    sx/=2*C['width_m']/N;sy/=2*C['height_m']/N
    expected=unit(np.stack([-sx,sy,np.ones_like(sx)],-1))
    decoded=n.astype(np.float64)/127.5-1
    normals=unit(decoded)
    angle=np.degrees(np.arccos(np.clip((normals*expected).sum(-1),-1,1)))
    seams={k:seam_stats(a) for k,a in arrays.items()}
    mean=b.mean((0,1),dtype=np.float64)
    film=np.array(Image.open(ROOT/'source/film_mask.png'))/255
    damp=np.array(Image.open(ROOT/'source/damp_mask.png'))/255
    cavity=np.array(Image.open(ROOT/'source/crease_mask.png'))/255
    lichen=np.array(Image.open(ROOT/'source/lichen_mask.png'))/255
    small=np.array(rgb(b).resize((256,256),Image.Resampling.BOX),np.float32)
    cloud=gaussian_filter(small,(16,20,0),mode='wrap')
    repeat={f'shift_y{y}_x{x}':float(np.corrcoef(small.ravel(),np.roll(small,(y,x),(0,1)).ravel())[0,1]) for y,x in [(0,128),(128,0),(128,128),(0,85),(85,0)]}
    checks={
        'PNG_formats':True,'normal_from_delivered_height':bool(angle.max()<.42),
        'both_edge_mean_ratios_under_1_6':bool(all(s['mean_ratio']<1.6 for a in seams.values() for s in a.values())),
        'mean_within_1_code_value_of_target':bool(np.max(abs(mean-C['base_mean_target']))<1),
        'base_not_above_crown_ceiling':bool(np.all(b.max((0,1))<=C['base_ceiling'])),
        'height_full_18mm_used':bool(h.min()==0 and h.max()==65535),
        'roughness_0_8_to_0_92_quantized':bool(o[...,1].min()>=204 and o[...,1].max()<=235),
        'AO_0_6_to_1':bool(o[...,0].min()>=153),
        'metalness_zero':not bool(np.any(o[...,2])),
        'damp_smoother_than_dry':bool(np.median(o[...,1][damp>.5])<np.median(o[...,1][(damp<.05)&(film<.05)])),
        'macro_pigment_std_above_6':bool(cloud.std((0,1)).mean()>6),
    }
    result={'material':'fig_bark / second set','files':files,'coverage_m':[1.6,2.0],
        'height_full_range_mm':18,'height_actual_mm':[float(height.min()*1000),float(height.max()*1000)],
        'height_normal_angle_degrees':{'mean':float(angle.mean()),'p99':float(np.quantile(angle,.99)),'maximum':float(angle.max())},
        'slope_degrees_quantiles_p05_p50_p90_p99':np.quantile(np.degrees(np.arccos(expected[...,2])),[.05,.5,.9,.99]).tolist(),
        'seams_8bit_equivalent':seams,'base_mean_sRGB':mean.tolist(),'base_std_sRGB':b.std((0,1),dtype=np.float64).tolist(),
        'base_min_sRGB':b.min((0,1)).tolist(),'base_max_sRGB':b.max((0,1)).tolist(),
        'base_percentiles_p01_p05_p50_p95_p99':np.percentile(b,[1,5,50,95,99],axis=(0,1)).tolist(),
        'macro_blur_sigma_m':.125,'macro_blur_std_sRGB':cloud.std((0,1)).tolist(),
        'internal_shift_correlations':repeat,
        'AO_quantiles_min_p01_p10_p50_p90_max':np.quantile(o[...,0]/255,[0,.01,.1,.5,.9,1]).tolist(),
        'AO_in_crease_mask_above_0_3':region(o[...,0]/255,cavity>.3),
        'roughness_range':[float(o[...,1].min()/255),float(o[...,1].max()/255)],
        'damp_roughness_median':float(np.median(o[...,1][damp>.5]/255)),
        'dry_roughness_median':float(np.median(o[...,1][(damp<.05)&(film<.05)]/255)),
        'film_coverage_above_0_2':float((film>.2).mean()),'damp_coverage_above_0_2':float((damp>.2).mean()),
        'lichen_coverage_above_0_2':float((lichen>.2).mean()),'metalness_nonzero_pixels':int(np.count_nonzero(o[...,2])),
        'preview':{**C['preview'],'camera_height_m':1.6,'surface_height_m':4,'supersampling':2,
            'distance_reference':'camera to closest/front surface; centre = distance + radius',
            'texture_filter':'periodic trilinear mips; linear-light base; decoded normals averaged then renormalized',
            'shading':'Lambert + rough dielectric GGX; fixed exposure; AO affects uniform sky only; no cast shadows, bounced light, displacement, tone mapping, or auto-exposure'},
        'checks_passed':checks}
    (OUT/'metrics.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({k:result[k] for k in ('base_mean_sRGB','base_std_sRGB','height_normal_angle_degrees','checks_passed')},indent=2),flush=True)
    for key,axes in seams.items():print(key,{a:round(s['mean_ratio'],3) for a,s in axes.items()},flush=True)
    sheet([('Base | unlit sRGB',rgb(b)),('Height | greyscale16; full range 18 mm',rgb(h)),('Normal | physical OpenGL',rgb(n)),('ORM | AO / roughness / zero metal',rgb(o))],'layers.jpg')
    sheet([('AO | creases and wrinkles',rgb(o[...,0])),('Roughness | linear',rgb(o[...,1]))],'ao_roughness.jpg')
    sheet([(key+' | wraps moved to centre',rgb(np.roll(a,(N//2,N//2),(0,1)))) for key,a in arrays.items()],'offsets.jpg')
    for nx,ny,tile_px in [(3,3,682),(4,8,384)]:
        tile=rgb(b).resize((tile_px,tile_px),Image.Resampling.LANCZOS)
        tiled=Image.new('RGB',(nx*tile_px,ny*tile_px))
        for y in range(ny):
            for x in range(nx):tiled.paste(tile,(x*tile_px,y*tile_px))
        tiled.save(OUT/f'base_tile{nx}x{ny}.jpg',quality=96,subsampling=0)
    native=Image.new('RGB',(N*3,N*3))
    for y in range(3):
        for x in range(3):native.paste(rgb(b),(x*N,y*N))
    native.save(OUT/'base_tile3x3_native.png')
    sheet([(f'Native source {s.upper()}',Image.open(ROOT/f'source/fig_skin_{s}.png')) for s in 'abcd'],'source_overview.jpg',cell=(627,627))
    lights=[('front',0),('side',75)]
    lit=[(f'Low sun {name}',rgb(srgb(light(linear(b.astype(np.float32)),normals,o/255,az)))) for name,az in lights]
    sheet(lit,'relighting_flat.jpg')
    bounds=(640,640,1408,1408)
    sheet([(label+' | native texels',im.crop(bounds)) for label,im in [('Base',rgb(b)),('Height',rgb(h)),*lit]],'detail.jpg')
    neutral=np.broadcast_to(linear(np.array([150.,150.,138.])),b.shape)
    sheet([(f'Constant pigment | low sun {name}',rgb(srgb(light(neutral,normals,o/255,az)))) for name,az in lights],'geometry_only.jpg')
    if '--no-render' not in sys.argv:
        chains=[mipchain(linear(b.astype(np.float32))),mipchain(normals),mipchain(o/255)]
        for kind,diameter in [('flat',1.6),('cylinder',1.8),('cylinder',.4)]:
            views=[];crops=[]
            for distance in C['preview']['distances_to_front_surface_m']:
                for name,az in lights:
                    print(f'Rendering {kind} {diameter:g} m, distance {distance:g} m, {name} sun...',flush=True)
                    im=render_scene(chains,kind,distance,az,diameter)
                    title=f'{diameter:g} m {kind} / {distance:g} m away / sun {name}'
                    views.append((title,im))
                    crops.append((title,im.crop((576,156,1344,924))))
            stem=f'cylinder_{diameter:g}m' if kind=='cylinder' else 'flat'
            sheet(views,f'{stem}_distances.jpg',cell=(960,540))
            sheet(crops,f'{stem}_native_crops.jpg',cell=(768,768))
    if '--rebuild' in sys.argv:
        print('Verifying independent frozen-source rebuild...',flush=True)
        with tempfile.TemporaryDirectory(prefix='rebuild_',dir=OUT) as tmp:
            dest=Path(tmp);(dest/'source').mkdir()
            for filename in ['build_material.py','material.json',*C['sources'],'source/srgb.icc']:
                shutil.copyfile(ROOT/filename,dest/filename)
            subprocess.run([sys.executable,str(dest/'build_material.py')],check=True)
            matches={}
            for key,info in files.items():
                fresh=hashlib.sha256((dest/info['file']).read_bytes()).hexdigest()
                matches[key]={'delivered_sha256':info['sha256'],'rebuilt_sha256':fresh,'identical':fresh==info['sha256']}
            (OUT/'rebuild.json').write_text(json.dumps({'all_four_byte_identical':all(v['identical'] for v in matches.values()),'files':matches},indent=2)+'\n')
            assert all(v['identical'] for v in matches.values())
            print('All four runtime PNGs rebuilt byte-for-byte.',flush=True)
    assert all(checks.values()),'Material assertion failed; inspect checks/metrics.json'


if __name__=='__main__':main()
