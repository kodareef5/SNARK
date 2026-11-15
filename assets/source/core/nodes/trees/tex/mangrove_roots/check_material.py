#!/usr/bin/env python3
"""Independent QA from delivered PNGs. Writes only this folder's checks/.

No importing the build's normal function: a separate implementation checks the
physical convention and quantization. PNG IHDR is inspected for bit depth/type.
"""
from pathlib import Path
import json
import hashlib
import struct
import sys
import shutil
import subprocess
import tempfile
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy.ndimage import map_coordinates, gaussian_filter

ROOT=Path(__file__).resolve().parent
C=json.loads((ROOT/'material.json').read_text())
OUT=ROOT/'checks';OUT.mkdir(exist_ok=True)
N=2048
try:FONT=ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf',20)
except OSError:FONT=ImageFont.load_default()


def rgb(a):
    if a.ndim==2:
        if a.dtype==np.uint16:a=a.astype('float32')/257
        a=np.repeat(a[...,None],3,-1)
    return Image.fromarray(np.uint8(np.clip(np.rint(a),0,255)))


def sheet(items,filename,cell=768,cols=2):
    rows=(len(items)+cols-1)//cols
    out=Image.new('RGB',(cell*cols,(cell+42)*rows),'#1C2021')
    d=ImageDraw.Draw(out)
    for i,(title,im) in enumerate(items):
        x=(i%cols)*cell;y=(i//cols)*(cell+42)
        d.text((x+16,y+10),title,fill='#E2E4D9',font=FONT)
        out.paste(im.resize((cell,cell),Image.Resampling.LANCZOS),(x,y+42))
    out.save(OUT/filename,quality=94,subsampling=0)


def unit(a):return a/np.maximum(np.linalg.norm(a,axis=-1,keepdims=True),1e-12)


def linear(a):
    a=a/255
    return np.where(a<=.04045,a/12.92,((a+.055)/1.055)**2.4)


def srgb(a):
    a=np.maximum(a,0)
    return np.clip(np.where(a<=.0031308,a*12.92,1.055*a**(1/2.4)-.055)*255,0,255)


def light(base,norm,orm,direction):
    """Neutral dielectric GGX + Lambert preview, diffuse environment plus sun."""
    l=unit(np.array(direction,dtype='float32'))
    half=unit(l+np.array([0.,0.,1.]))
    nl=np.clip(np.sum(norm*l,axis=-1),0,1)
    nv=np.clip(norm[...,2],.001,1)
    nh=np.clip(np.sum(norm*half,axis=-1),0,1)
    vh=float(half[2])
    a2=(orm[...,1]/255)**4
    distribution=a2/(np.pi*(nh*nh*(a2-1)+1)**2+1e-7)
    k=((orm[...,1]/255)+1)**2/8
    geometry=(nv/(nv*(1-k)+k))*(nl/(nl*(1-k)+k))
    fresnel=.04+.96*(1-vh)**5
    spec=distribution*geometry*fresnel/(4*nv*nl+1e-5)
    ao=orm[...,0]/255
    diffuse=linear(base)
    # Cavity obscures environment; direct light responds only to the normal.
    shaded=diffuse*(.34*ao[...,None]+.90*nl[...,None])
    shaded+=spec[...,None]*nl[...,None]*.6
    return srgb(shaded)


def seam_stats(a):
    a=a.astype('float64')
    if a.ndim==2:a=a[...,None]/257
    result={}
    for ax,name,required in [(1,'left_right',True),(0,'top_bottom',C['wrap_y'])]:
        inside=np.abs(np.diff(a,axis=ax))
        seam=np.abs(np.take(a,0,axis=ax)-np.take(a,-1,axis=ax))
        lines=inside.mean(axis=tuple(i for i in range(3) if i!=ax))
        mean=float(inside.mean());smean=float(seam.mean())
        result[name]={'required':required,'edge_mean_8bit_equivalent':smean,
                      'interior_mean_8bit_equivalent':mean,'edge_to_interior_mean_ratio':smean/max(mean,1e-9),
                      'interior_line_p95':float(np.quantile(lines,.95)),
                      'edge_p99':float(np.quantile(seam,.99)),
                      'interior_p99':float(np.quantile(inside,.99)),
                      'edge_line_percentile':float(np.mean(lines<=smean)*100)}
    return result


def cylinders(base,norm,orm):
    # Additional curved-surface check: normals transformed into cylinder frame.
    H,W=1500,1000
    out=Image.new('RGB',(2*W,H),'#24292A')
    yy,xx=np.mgrid[:H,:W]
    valid=(yy>80)&(yy<H-70)
    coords=(yy-80)/(H-150)*(N-1)
    radius_px=140 if C['name']!='mangrove_roots' else 56
    centres=[W*.5] if C['name']!='mangrove_roots' else [W*.22,W*.5,W*.78]
    for j,direction in enumerate([[-.72,.35,.55],[.72,-.35,.55]]):
        canvas=np.full((H,W,3),[36,41,42],dtype='float32')
        for ci,centre in enumerate(centres):
            x=(xx-centre)/radius_px
            visible=valid&(np.abs(x)<.999)
            phi=np.arcsin(np.clip(x,-.999,.999))
            real_radius=.25 if C['name']!='mangrove_roots' else .08
            u=((phi*real_radius/C['width_m']+.42+ci*.29)%1)*N
            def sample(a):
                return np.stack([map_coordinates(a[...,c].astype('float32'),[np.clip(coords,0,N-1),u],order=1,mode='grid-wrap') for c in range(3)],-1)
            b=sample(base);n=unit(sample(norm));o=sample(orm)
            world=np.stack([np.cos(phi)*n[...,0]+np.sin(phi)*n[...,2],n[...,1],-np.sin(phi)*n[...,0]+np.cos(phi)*n[...,2]],-1)
            rendered=light(b,unit(world),o,direction)
            canvas[visible]=rendered[visible]
        out.paste(rgb(canvas),(j*W,0))
    d=ImageDraw.Draw(out)
    d.text((24,24),'Upper left light | physical tangent normals',font=FONT,fill='white')
    d.text((W+24,24),'Lower right light | same maps',font=FONT,fill='white')
    out.save(OUT/'cylinders.jpg',quality=94,subsampling=0)


def main():
    arrays={};files={}
    for k in ['base','height','normal','orm']:
        p=ROOT/f"{C['name']}_{k}.png"
        im=Image.open(p);a=np.array(im)
        raw=p.read_bytes();w,h,depth,ctype,_,_,_=struct.unpack('>IIBBBBB',raw[16:29])
        assert (w,h)==(N,N)
        assert (depth,ctype)==((16,0) if k=='height' else (8,2)),(k,depth,ctype)
        assert ('icc_profile' in im.info)==(k=='base')
        arrays[k]=a
        files[k]={'file':p.name,'size':[w,h],'PNG_bit_depth':depth,'PNG_color_type':ctype,
                  'dtype':str(a.dtype),'sha256':hashlib.sha256(raw).hexdigest(),'sRGB_profile':k=='base'}
    b,h,n,o=[arrays[k] for k in ['base','height','normal','orm']]
    height=h.astype('float64')/65535*C['height_range_mm']/1000
    slope_x=(np.concatenate([height[:,1:],height[:,:1]],axis=1)-np.concatenate([height[:,-1:],height[:,:-1]],axis=1))/(2*C['width_m']/N)
    if C['wrap_y']:
        slope_y=(np.concatenate([height[1:],height[:1]],axis=0)-np.concatenate([height[-1:],height[:-1]],axis=0))/(2*C['height_m']/N)
    else:
        slope_y=np.empty_like(height)
        pitch=C['height_m']/(N-1)
        slope_y[1:-1]=(height[2:]-height[:-2])/(2*pitch)
        slope_y[0]=(-3*height[0]+4*height[1]-height[2])/(2*pitch)
        slope_y[-1]=(3*height[-1]-4*height[-2]+height[-3])/(2*pitch)
    expected=unit(np.stack([-slope_x,slope_y,np.ones_like(height)],-1))
    decoded=n.astype('float64')/127.5-1
    norm=unit(decoded)
    angle=np.degrees(np.arccos(np.clip((norm*expected).sum(-1),-1,1)))
    lengths=np.linalg.norm(decoded,axis=-1)
    seams={k:seam_stats(a) for k,a in arrays.items()}
    assert angle.max()<.42,angle.max()
    assert not np.any(o[...,2])
    assert (o[...,1]/255).min()>=.34 and (o[...,1]/255).max()<=.91
    sheet([(f"{C['name']} | sRGB unlit base",rgb(b)),(f"16-bit height | full range {C['height_range_mm']:g} mm",rgb(h)),
           ('OpenGL normal | physical height gradient',rgb(n)),('Linear ORM | AO / roughness / zero metal',rgb(o))],'layers.jpg')
    sheet([('Native generated source A',Image.open(ROOT/'source'/f"{C['source_prefix']}_a.png")),
           ('Native generated source B',Image.open(ROOT/'source'/f"{C['source_prefix']}_b.png")),
           ('2304px quilt | before material separation',Image.open(ROOT/'source/composed_master_2304.png')),
           ('2048px unlit pigment | final',rgb(b))],'source_overview.jpg',cell=640)
    sheet([('AO | horizon visibility',rgb(o[...,0])),('Roughness | linear',rgb(o[...,1]))],'ao_roughness.jpg')
    small=rgb(b).resize((512,512),Image.Resampling.LANCZOS)
    if C['wrap_y']:
        tiled=Image.new('RGB',(1536,1536))
        for y in range(3):
            for x in range(3):tiled.paste(small,(x*512,y*512))
        tiled.save(OUT/'base_tile3x3.jpg',quality=94,subsampling=0)
        tile=rgb(b).resize((384,384),Image.Resampling.LANCZOS)
        tall=Image.new('RGB',(1536,3072))
        for y in range(8):
            for x in range(4):tall.paste(tile,(x*384,y*384))
        tall.save(OUT/'base_tile4x8.jpg',quality=94,subsampling=0)
    else:
        tile=rgb(b).resize((1024,1024),Image.Resampling.LANCZOS)
        tiled=Image.new('RGB',(2048,1024));tiled.paste(tile);tiled.paste(tile,(1024,0))
        tiled.save(OUT/'base_tile2x1.jpg',quality=94,subsampling=0)
    shift=(N//2 if C['wrap_y'] else 0,N//2)
    sheet([(k+' | seams moved into view',rgb(np.roll(a,shift,(0,1)))) for k,a in arrays.items()],'offsets.jpg')
    lights=[('Upper left light',[-.68,.55,.48]),('Lower right light',[.68,-.55,.48])]
    lit=[(label,rgb(light(b,norm,o,direction))) for label,direction in lights]
    sheet(lit,'relighting.jpg')
    # Same native 768px crop in every layer: no interpolation conceals registration.
    bounds=(640,640,1408,1408) if C['wrap_y'] else (640,1230,1408,1998)
    sheet([(label+' | native pixels',im.crop(bounds)) for label,im in [('Unlit base',rgb(b)),('Height',rgb(h)),*lit]],'detail.jpg',cell=768)
    cylinders(b,norm,o)
    seam_ok=all(v['edge_to_interior_mean_ratio']<2.25 for layer in seams.values() for v in layer.values() if v['required'])
    result={'material':C['name'],'files':files,'coverage_m':[C['width_m'],C['height_m']],
            'wrap':{'x':True,'y':C['wrap_y']},'height_full_range_mm':C['height_range_mm'],
            'height_actual_mm':[float(height.min()*1000),float(height.max()*1000)],
            'height_normal_degrees':{'mean':float(angle.mean()),'p99':float(np.quantile(angle,.99)),'max':float(angle.max())},
            'decoded_normal_length':{'min':float(lengths.min()),'max':float(lengths.max())},
            'slope_degrees':{'median':float(np.median(np.degrees(np.arccos(expected[...,2])))),'p95':float(np.quantile(np.degrees(np.arccos(expected[...,2])),.95))},
            'base_mean_sRGB':b.mean((0,1)).tolist(),'base_channel_std':b.std((0,1)).tolist(),
            'AO_quantiles':np.quantile(o[...,0]/255,[0,.01,.1,.5,.9,1]).tolist(),
            'roughness_quantiles':np.quantile(o[...,1]/255,[0,.01,.1,.5,.9,1]).tolist(),
            'metalness_nonzero_pixels':int(np.count_nonzero(o[...,2])),
            'seams_8bit_equivalent':seams,
            'checks_passed':{'formats':True,'normal_from_height':True,'metalness':True,'roughness_range':True,'required_seam_mean_below_2_25x_interior':seam_ok}}
    if not C['wrap_y']:
        z=np.linspace(2,-.2,N)
        wet=np.array(Image.open(ROOT/'source/wet_mask.png'))/255
        line=[]
        for x in range(N):line.append(float(z[np.argmin(np.abs(wet[:,x]-.5))]))
        result['root_height_mapping']={'top_edge_m':2.0,'bottom_edge_m':-.2,'mud_row_float':2/2.2*(N-1),
             'wet_50percent_line_above_mud_m':[min(line),max(line)],
             'wet_50percent_line_from_bottom_m':[min(line)+.2,max(line)+.2],
             'wet_band_roughness_median':float(np.median(o[...,1][wet>.95]/255)),
             'dry_roughness_median':float(np.median(o[...,1][wet<.05]/255)),
             'boundary_valid':min(line)>=.15 and max(line)<=.35}
        assert result['root_height_mapping']['boundary_valid']
        guide=Image.new('RGB',(1480,1100),'#24292A')
        guide.paste(rgb(b).resize((1024,1024),Image.Resampling.LANCZOS),(20,44))
        draw=ImageDraw.Draw(guide)
        draw.text((20,12),'World-height mapping | wrap X, clamp Y',font=FONT,fill='white')
        for height_z,label_text in [(2.0,'+2.00 m | top'),(1.0,'+1.00 m'),(.35,'+0.35 m | wet-line limit'),(.15,'+0.15 m | wet-line limit'),(0,'0.00 m | mud'),(-.2,'-0.20 m | bottom')]:
            yy=44+int((2-height_z)/2.2*1024)
            draw.line((20,yy,1065,yy),fill='#D7CB9B',width=1)
            draw.text((1075,yy-10),label_text,font=FONT,fill='white')
        guide.save(OUT/'height_mapping.jpg',quality=94,subsampling=0)
    if C['name']=='oak_bark':
        crack=np.array(Image.open(ROOT/'source/crack_mask.png'))>0
        result['oak_cavities']={'crack_area_fraction':float(crack.mean()),'median_crack_AO':float(np.median(o[...,0][crack]/255)),
                               'median_plate_AO':float(np.median(o[...,0][~crack]/255))}
    (OUT/'metrics.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({k:result[k] for k in ['material','height_normal_degrees','slope_degrees','checks_passed']},indent=2))
    for k,v in seams.items():print(k,{axis:round(s['edge_to_interior_mean_ratio'],3) for axis,s in v.items()})
    assert seam_ok,'Seam exceeds interior mean threshold; inspect metrics and offsets.'
    if '--rebuild' in sys.argv:
        print('Rebuilding independently from the two frozen source paintings...',flush=True)
        with tempfile.TemporaryDirectory(prefix='rebuild_',dir=OUT) as temp:
            dest=Path(temp)
            (dest/'source').mkdir();(dest/'checks').mkdir()
            for filename in ['build_material.py','material.json']:
                shutil.copyfile(ROOT/filename,dest/filename)
            for filename in [f"{C['source_prefix']}_a.png",f"{C['source_prefix']}_b.png",'srgb.icc']:
                shutil.copyfile(ROOT/'source'/filename,dest/'source'/filename)
            subprocess.run([sys.executable,str(dest/'build_material.py')],check=True)
            matches={}
            for k,info in files.items():
                fresh=hashlib.sha256((dest/info['file']).read_bytes()).hexdigest()
                matches[k]={'delivered_sha256':info['sha256'],'rebuilt_sha256':fresh,'identical':fresh==info['sha256']}
            (OUT/'rebuild.json').write_text(json.dumps({'all_four_byte_identical':all(x['identical'] for x in matches.values()),'files':matches},indent=2)+'\n')
            assert all(x['identical'] for x in matches.values()),'Rebuild differs from delivered PNGs'
            print('All four PNGs rebuilt byte-for-byte identically.',flush=True)


if __name__=='__main__':main()
