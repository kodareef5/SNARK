#!/usr/bin/env python3
"""Independent delivery validation and review images. Run after build_atlas.py.

Checks the actual PNGs and layout, never calls the build's normal-map function.
Every failure is recorded in checks/measurements.json and gives exit status 1.
"""
from pathlib import Path
import hashlib
import json
import math
import shutil
import struct
import subprocess
import sys
import tempfile
import time
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage as ndi

ROOT=Path(__file__).resolve().parent
OUT=ROOT/'checks'
DARK=(48,50,51)
BACKGROUNDS={'dark_grey':DARK,'white':(255,255,255),'mid_green':(83,119,76)}


def font(size):
    for p in ['/System/Library/Fonts/Supplemental/Arial.ttf','/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf']:
        if Path(p).exists(): return ImageFont.truetype(p,size)
    return ImageFont.load_default()


def png_header(path):
    data=path.read_bytes()
    w,h,bits,colour,_,_,_=struct.unpack('>IIBBBBB',data[16:29])
    return {'width':w,'height':h,'bit_depth':bits,'colour_type':colour,
            'sha256':hashlib.sha256(data).hexdigest()}


def composite(rgb,alpha,bg):
    a=np.asarray(alpha,dtype=float)[...,None]/255
    return Image.fromarray(np.clip(np.rint(np.asarray(rgb)*a+np.asarray(bg)*(1-a)),0,255).astype('uint8'))


def raw_mip(rgb,alpha,size):
    # Explicit independent RGB/alpha averaging: models the brief's mip path,
    # which is stricter than Pillow's automatically premultiplied RGBA resize.
    c=np.asarray(Image.fromarray(rgb).resize(size,Image.Resampling.BOX))
    a=np.asarray(Image.fromarray(alpha).resize(size,Image.Resampling.BOX))
    return c,a


def expected_vectors(z,mask,e,ppm,mm):
    """Independent finite-difference implementation, in world metres."""
    z=z.astype(float)*mm/(65535*1000)
    gx=np.empty_like(z);gy=np.empty_like(z)
    if e['name']=='stalk':
        px=math.pi*.015/z.shape[1]
        gx[:,1:-1]=(z[:,2:]-z[:,:-2])/(2*px)
        gx[:,0]=(z[:,1]-z[:,-1])/(2*px);gx[:,-1]=(z[:,0]-z[:,-2])/(2*px)
    else:
        gx[:,1:-1]=(z[:,2:]-z[:,:-2])*(ppm*.5)
        gx[:,0]=(z[:,1]-z[:,0])*ppm;gx[:,-1]=(z[:,-1]-z[:,-2])*ppm
    if e.get('role')=='bark':
        py=e['metres']/z.shape[0]
        gy[1:-1]=(z[2:]-z[:-2])/(2*py)
        gy[0]=(z[1]-z[-1])/(2*py);gy[-1]=(z[0]-z[-2])/(2*py)
    else:
        gy[1:-1]=(z[2:]-z[:-2])*(ppm*.5)
        gy[0]=(z[1]-z[0])*ppm;gy[-1]=(z[-1]-z[-2])*ppm
    result=np.stack([-gx,gy,np.ones_like(z)],axis=-1)
    result/=np.linalg.norm(result,axis=-1,keepdims=True)
    result[~mask]=[0,0,1]
    return result


def linearize(c):
    c=np.asarray(c,dtype=float)/255
    return np.where(c<=.04045,c/12.92,((c+.055)/1.055)**2.4)


def encode_srgb(c):
    return np.clip(np.where(c<=.0031308,c*12.92,1.055*np.maximum(c,0)**(1/2.4)-.055)*255,0,255)


def light(rgb,n,orm,direction):
    l=np.array(direction,dtype=float);l/=np.linalg.norm(l)
    cosine=np.maximum(0,np.einsum('...c,c->...',n,l))
    diffuse=.26+.78*cosine
    # A restrained roughness-aware highlight makes material differences visible.
    half=l+np.array([0,0,1.]);half/=np.linalg.norm(half)
    nh=np.maximum(0,np.einsum('...c,c->...',n,half))
    rough=orm[...,1]/255
    shine=.035*(1-rough)*nh**(8+50*(1-rough))
    result=linearize(rgb)*diffuse[...,None]*(orm[...,:1]/255)+shine[...,None]
    return np.rint(encode_srgb(result)).astype('uint8')


def check_rebuild():
    """Reproduce delivery from frozen originals in an empty local directory."""
    start=time.perf_counter()
    with tempfile.TemporaryDirectory(prefix='.rebuild-',dir=OUT) as directory:
        target=Path(directory);(target/'source').mkdir()
        shutil.copy2(ROOT/'build_atlas.py',target/'build_atlas.py')
        shutil.copy2(ROOT/'source/recipe.json',target/'source/recipe.json')
        for source in (ROOT/'source').glob('*_original.png'):
            shutil.copy2(source,target/'source'/source.name)
        run=subprocess.run([sys.executable,str(target/'build_atlas.py')],cwd=target,
                           text=True,capture_output=True)
        files={}
        for name in [f'palmetto_{k}.png' for k in ['base','height','normal','orm']]+['layout.json']:
            expected=hashlib.sha256((ROOT/name).read_bytes()).hexdigest()
            actual=hashlib.sha256((target/name).read_bytes()).hexdigest() if (target/name).exists() else None
            files[name]={'sha256':expected,'rebuilt_sha256':actual,'matches':actual==expected}
        result={'passed':run.returncode==0 and all(f['matches'] for f in files.values()),
                'method':'Fresh isolated directory containing only build_atlas.py, source/recipe.json and frozen original PNGs; no image-generation cache or network.',
                'elapsed_seconds':round(time.perf_counter()-start,3),'files':files}
        if run.returncode:result['error']=run.stderr
    (OUT/'rebuild.json').write_text(json.dumps(result,indent=2)+'\n')
    return result


def main():
    OUT.mkdir(exist_ok=True)
    layout=json.loads((ROOT/'layout.json').read_text())
    recipe=json.loads((ROOT/'source/recipe.json').read_text())
    ppm=layout['scale_px_per_m'];mm=recipe['height_range_mm']
    files={k:ROOT/f'palmetto_{k}.png' for k in ['base','height','normal','orm']}
    headers={k:png_header(v) for k,v in files.items()}
    images={k:Image.open(v) for k,v in files.items()}
    base=np.asarray(images['base']);height=np.asarray(images['height'])
    normal=np.asarray(images['normal']);orm=np.asarray(images['orm'])
    rgb=base[...,:3];a=base[...,3]
    n=normal.astype(float)/127.5-1;length=np.linalg.norm(n,axis=-1)
    n/=length[...,None]
    failures=[]
    def require(condition,message):
        if not condition: failures.append(message)
    for k,hdr in headers.items():
        require((hdr['width'],hdr['height'])==(2048,2048),f'{k}: wrong dimensions')
    require((headers['base']['bit_depth'],headers['base']['colour_type'])==(8,6),'Base must be RGBA8')
    require((headers['height']['bit_depth'],headers['height']['colour_type'])==(16,0),'Height must be grey16')
    for k in ['normal','orm']:
        require((headers[k]['bit_depth'],headers[k]['colour_type'])==(8,2),f'{k} must be RGB8')
    require(np.all(height[a==0]==0),'Height outside alpha must be zero')
    require(np.all(orm[...,2]==0),'Metalness must be zero')
    require(not (ROOT/'palmetto_regions.png').exists(),'Regions were not requested')
    require(ppm==1100,'Card scale changed')
    # Round 2 is deliberately confined to the stalk, including transparent RGB
    # padding. These independent hashes were frozen before editing any output.
    baseline=json.loads((ROOT/'source/round2_baseline.json').read_text())
    preserved={}
    def pixels_sha(arr):
        return hashlib.sha256(np.ascontiguousarray(arr).tobytes()).hexdigest()
    for key,arr in [('base',base),('height',height),('normal',normal),('orm',orm)]:
        old=baseline['layers'][key]
        unchanged=pixels_sha(np.concatenate([arr[:,:1856],arr[:,1920:]],axis=1))==old['outside_stalk_pixels_sha256']
        elements={e['name']:pixels_sha(arr[e['rect'][1]:e['rect'][3],e['rect'][0]:e['rect'][2]])==old['elements'][e['name']]
                  for e in layout['elements'] if e['name']!='stalk'}
        preserved[key]={'outside_stalk_identical':unchanged,'elements':elements}
        require(unchanged and all(elements.values()),f'{key}: pixels outside stalk changed')
    same_layout=hashlib.sha256((ROOT/'layout.json').read_bytes()).hexdigest()==baseline['layout_sha256']
    require(same_layout,'Layout changed from round one')
    required={f'fan{i}' for i in range(1,7)}|{'deadfan1','deadfan2','spear1','stalk','bark'}
    require({e['name'] for e in layout['elements']}==required,'Missing or unexpected elements')
    occupied=np.zeros((2048,2048),bool)
    per={};all_angles=[];seams={}
    for e in layout['elements']:
        name=e['name'];x0,y0,x1,y1=e['rect'];sl=(slice(y0,y1),slice(x0,x1))
        require(0<=x0<x1<=2048 and 0<=y0<y1<=2048,f'{name}: invalid rectangle')
        require(not occupied[sl].any(),f'{name}: rectangle overlaps')
        occupied[sl]=True
        ca=a[sl];mask=ca>0;solid=ca>=128
        yy,xx=np.where(mask)
        margins=[int(xx.min()),int(yy.min()),int(x1-x0-1-xx.max()),int(y1-y0-1-yy.max())]
        half=(ca>0)&(ca<255)
        # Fractional alpha is only permitted right on a contour.
        edge_distance=ndi.distance_transform_edt(mask)
        core_half=int(np.count_nonzero(half & (edge_distance>2.1)))
        require(core_half==0,f'{name}: fractional alpha in solid interiors')
        labels,count=ndi.label(solid)
        areas=np.bincount(labels.ravel());areas=areas[1:]
        expected=expected_vectors(height[sl],mask,e,ppm,mm)
        agreement=np.clip(np.einsum('...c,...c->...',expected,n[sl]),-1,1)
        angles=np.degrees(np.arccos(agreement[mask]));all_angles.append(angles)
        require(float(angles.max())<.4,f'{name}: normals do not match height')
        require(float(np.max(np.abs(length[sl][mask]-1)))<.007,f'{name}: non-unit normals')
        metric={'alpha_coverage':float(np.mean(ca/255)),
                'nonzero_alpha_fraction':float(mask.mean()),
                'half_transparent_fraction_of_rectangle':float(half.mean()),
                'half_transparent_fraction_of_visible':float(half.sum()/mask.sum()),
                'fractional_alpha_more_than_2px_inside':core_half,
                'margins_px_left_top_right_bottom':margins,
                'alpha_bbox':[int(x0+xx.min()),int(y0+yy.min()),int(x0+xx.max()+1),int(y0+yy.max()+1)],
                'opaque_components':int(count),'components_larger_than_4px':int(np.count_nonzero(areas>4)),
                'height_mm_min_max':[float(height[sl][mask].min()/65535*mm),float(height[sl][mask].max()/65535*mm)],
                'roughness_mean':float(orm[sl][...,1][solid].mean()/255),
                'ao_mean':float(orm[sl][...,0][solid].mean()/255),
                'normal_error_degrees_mean':float(angles.mean()),
                'normal_error_degrees_max':float(angles.max())}
        if e.get('role')!='bark':
            require(min(margins)>=24,f'{name}: less than 24 px margin')
            ax,ay=e['anchor'];tx,ty=e['tip']
            require(a[ay,ax]>=128,f'{name}: anchor misses opaque surface')
            require(a[ty,tx]>=128,f'{name}: tip misses opaque surface')
            require(ty<ay,f'{name}: does not grow up')
            require(abs(ax-(x0+x1)/2)<=10,f'{name}: anchor not bottom-middle')
            actual=math.dist(e['anchor'],e['tip'])/ppm
            require(abs(actual-e['metres'])<1e-5,f'{name}: wrong anchor-tip metres')
            width=(xx.max()-xx.min()+1)/ppm
            metric['width_m']=float(width);metric['anchor_tip_metres']=actual
            if name.startswith('fan'):
                require(.55<=width<=.85,f'{name}: width outside 55-85 cm')
            if name=='spear1':require(.4<=actual<=.6,'Spear outside 40-60 cm')
        else:
            expected_rect=[1856,0,1920,2048] if name=='stalk' else [1920,0,2048,2048]
            require(e['rect']==expected_rect,f'{name}: incorrect column rectangle')
            require(e['metres']==(1.0 if name=='stalk' else .8),f'{name}: wrong repeat length')
            require(np.all(ca==255),f'{name}: wrapped material must be fully opaque edge to edge')
            seams[name]={}
            for k,arr in [('base',base),('height',height),('normal',normal),('orm',orm)]:
                c=arr[sl].astype(float)
                delta=np.abs(c[0]-c[-1])
                seams[name][k]={'maximum_wrap_delta':float(delta.max()),'mean_wrap_delta':float(delta.mean())}
                require(delta.max()==0,f'{name}: {k} vertical seam mismatch')
            if name=='stalk':
                # A narrow rounded shaft used to add several mm of false
                # curvature. Test shallow relief and its broad width profile.
                z=height[sl].astype(float)*mm/65535
                profile=ndi.gaussian_filter1d(z.mean(axis=0),5,mode='wrap')
                profile_span=float(np.ptp(profile))
                centre_flank=abs(float(z[:,24:40].mean()-np.concatenate([z[:,:12],z[:,-12:]],axis=1).mean()))
                require(z.max()<.8,'Stalk relief exceeds shallow surface detail')
                require(profile_span<.10 and centre_flank<.08,'Stalk height contains broad tube roundness')
                colour=rgb[sl].astype(float)
                lum=np.einsum('...c,c->...',colour,[.2126,.7152,.0722])
                centre=float(lum[:,24:40].mean());left=float(lum[:,:10].mean());right=float(lum[:,-10:].mean())
                require(centre>left+5 and centre>right+5,'Stalk centre must be paler than both flanks')
                contrast=ndi.gaussian_filter(lum,(20,1),mode='wrap')-lum
                counts=[]
                for lo,hi in [(3,10),(54,61)]:
                    _,count=ndi.label(contrast[:,lo:hi].max(axis=1)>15)
                    counts.append(count)
                require(min(counts)>=12,'Stalk lacks two rows of distinct dark tooth marks')
                horizontal={}
                for key,arr in [('base',base),('height',height),('normal',normal),('orm',orm)]:
                    c=arr[sl].astype(float);delta=float(np.abs(c[:,0]-c[:,-1]).max())
                    horizontal[key]=delta
                    require(delta==0,f'Stalk {key}: circumference seam mismatch')
                metric['surface_checks']={'fully_opaque':bool(np.all(ca==255)),
                    'broad_height_profile_span_mm':profile_span,'centre_flank_height_delta_mm':centre_flank,
                    'centre_left_right_luminance':[centre,left,right],'tooth_marks_left_right':counts,
                    'circumference_seam_max_deltas':horizontal,'tube_diameter_m':.015,
                    'texel_width_m':math.pi*.015/64}
        per[name]=metric
    require(np.all(occupied),'Rectangles do not fill the atlas')
    half=(a>0)&(a<255)
    require(half.mean()<.025,'Excessive fractional alpha on atlas')
    # Check nearest-edge RGB dilation quantitatively, separate strip domains.
    bleed={}
    for name,x0,x1 in [('foliage',0,1856),('stalk',1856,1920),('bark',1920,2048)]:
        ca=a[:,x0:x1];c=rgb[:,x0:x1]
        dist,idx=ndi.distance_transform_edt(ca<250,return_indices=True)
        ring=(ca==0)&(dist<=32)
        errors=np.abs(c.astype(float)-c[tuple(idx)].astype(float))[ring]
        maximum=float(errors.max()) if errors.size else 0
        bleed[name]={'tested_pixels':int(ring.sum()),'max_channel_error':maximum}
        require(maximum<=1,f'{name}: insufficient 32 px edge bleed')
    # All visual review outputs use the final PNGs.
    small_rgb,small_a=raw_mip(rgb,a,(256,256))
    for name,bg in BACKGROUNDS.items():
        composite(rgb,a,bg).save(OUT/f'base_{name}_2048.png')
        composite(small_rgb,small_a,bg).save(OUT/f'base_{name}_256.png')
    preview=composite(rgb,a,DARK)
    overlay=preview.copy();draw=ImageDraw.Draw(overlay)
    for e in layout['elements']:
        x0,y0,x1,y1=e['rect']
        draw.rectangle((x0,y0,x1-1,y1-1),outline=(225,188,83),width=2)
        draw.text((x0+8,y0+5),e['name'],fill='white',font=font(23),stroke_width=2,stroke_fill=(20,20,20))
        if 'anchor' in e:
            ax,ay=e['anchor'];tx,ty=e['tip']
            draw.line((ax,ay,tx,ty),fill=(100,180,245),width=1)
            draw.ellipse((ax-7,ay-7,ax+7,ay+7),outline=(255,135,66),width=3)
            draw.line((tx-7,ty,tx+7,ty),fill=(75,240,230),width=3)
            draw.line((tx,ty-7,tx,ty+7),fill=(75,240,230),width=3)
    overlay.save(OUT/'layout.png')
    contact=Image.new('RGB',(1536,1584),(24,25,26));d=ImageDraw.Draw(contact)
    # Height is shown with its full delivered range, not contrast normalized.
    him=Image.fromarray(np.rint(height.astype(float)/257).astype('uint8')).convert('RGB')
    for i,(title,im) in enumerate([('BASE / alpha over grey',preview),('HEIGHT / 0-16 mm',him),('NORMAL / OpenGL',images['normal']),('ORM / AO, roughness, metalness',images['orm'])]):
        x=(i%2)*768;y=(i//2)*792
        contact.paste(im.resize((768,768),Image.Resampling.LANCZOS),(x,y+24))
        d.text((x+8,y+3),title,font=font(16),fill='white')
    contact.save(OUT/'layers.jpg',quality=95)
    # Every element, including material columns, gets two light directions.
    lights=[('upper_left',(-.72,.55,.65)),('lower_right',(.72,-.55,.65))]
    lit_full=[light(rgb,n,orm,vec) for _,vec in lights]
    thumbs=[]
    for e in layout['elements']:
        name=e['name'];x0,y0,x1,y1=e['rect'];sl=(slice(y0,y1),slice(x0,x1))
        ims=[composite(lit[sl],a[sl],DARK) for lit in lit_full]
        # Columns shown at native width and height; no undocumented stretching.
        pair=Image.new('RGB',((x1-x0)*2,(y1-y0)+32),DARK);pd=ImageDraw.Draw(pair)
        for j,im in enumerate(ims):
            pair.paste(im,(j*(x1-x0),32))
            label=f'{name} / {lights[j][0]}' if x1-x0>=300 else f'{name} '+('UL' if j==0 else 'LR')
            pd.text((j*(x1-x0)+4,5),label,font=font(15 if x1-x0>=300 else 11),fill='white')
        pair.save(OUT/f'lit_{name}.png')
        if e.get('role')!='bark':
            thumb=pair.copy();thumb.thumbnail((1000,300),Image.Resampling.LANCZOS);thumbs.append(thumb)
    lit_sheet=Image.new('RGB',(1000,sum(t.height for t in thumbs)),DARK)
    y=0
    for t in thumbs:lit_sheet.paste(t,((1000-t.width)//2,y));y+=t.height
    lit_sheet.save(OUT/'lighting_contact.jpg',quality=94)
    # Top-bottom join at centre, with a red locator outside the texture.
    seam_sheet=Image.new('RGB',(900,560),DARK);sd=ImageDraw.Draw(seam_sheet)
    for j,e in enumerate([x for x in layout['elements'] if x.get('role')=='bark']):
        x0,_,x1,_=e['rect'];cropped=np.concatenate([base[-128:,x0:x1],base[:128,x0:x1]],axis=0)
        tile=composite(cropped[...,:3],cropped[...,3],DARK)
        tile=tile.resize((tile.width*2,512),Image.Resampling.NEAREST)
        xpos=40+j*400;seam_sheet.paste(tile,(xpos,40))
        sd.text((xpos,8),e['name']+' vertical wrap x2',fill='white',font=font(18))
        sd.line((xpos-18,296,xpos-3,296),fill=(255,70,70),width=2)
    seam_sheet.save(OUT/'column_wrap.png')
    # A native-aspect detail crop makes the tiny surface relief reviewable.
    # The height contrast in this one preview is explicitly 0–0.8 mm; the
    # delivered height and main layer contact sheet retain the 0–16 mm scale.
    detail=Image.new('RGB',(1024,1090),DARK);dd=ImageDraw.Draw(detail)
    crop=(slice(256,768),slice(1856,1920))
    old=np.asarray(Image.open(ROOT/'source/stalk_round1_base.png'))[256:768]
    z=height[crop].astype(float)*mm/65535
    panels=[('ROUND 1 / base',composite(old[...,:3],old[...,3],DARK)),
            ('ROUND 2 / base',Image.fromarray(rgb[crop])),
            ('ALPHA / all 255',Image.fromarray(a[crop]).convert('RGB')),
            ('HEIGHT / 0-0.8 mm',Image.fromarray(np.rint(np.clip(z/.8,0,1)*255).astype('uint8')).convert('RGB')),
            ('NORMAL / OpenGL',images['normal'].crop((1856,256,1920,768))),
            ('ORM / AO,R,M',images['orm'].crop((1856,256,1920,768)))]
    dd.text((16,8),'Stalk detail: atlas rows 256–767, enlarged 2x without stretching',fill='white',font=font(17))
    for i,(title,im) in enumerate(panels):
        x=12+i*170;dd.text((x,35),title,fill='white',font=font(13))
        detail.paste(im.resize((128,1024),Image.Resampling.NEAREST),(x,60))
    detail.save(OUT/'stalk_detail.png')
    rebuild=None
    if '--rebuild' in sys.argv:
        rebuild=check_rebuild()
        require(rebuild['passed'],'Isolated rebuild differs from delivered files')
    # Mean-normal error is solely 8-bit vector quantization.
    angles=np.concatenate(all_angles)
    results={'passed':not failures,'failures':failures,'layers':headers,
       'scale_px_per_m':ppm,'height_range_mm':mm,
       'alpha_coverage':float(np.mean(a/255)),
       'half_transparent_fraction_of_atlas':float(half.mean()),
       'normal_agreement':{'mean_error_degrees':float(angles.mean()),'p99_error_degrees':float(np.percentile(angles,99)),
                           'max_error_degrees':float(angles.max()),'convention':'OpenGL (+Y up)'},
       'edge_bleed':bleed,'column_seams':seams,'elements':per,
       'round2_preservation':{'layout_byte_identical':same_layout,'layers':preserved},
       'isolated_rebuild':rebuild,
       'visual_review_note':'Automated files ready for human/agent visual inspection; the script does not judge photorealism.'}
    (OUT/'measurements.json').write_text(json.dumps(results,indent=2)+'\n')
    print(json.dumps({'passed':results['passed'],'failures':failures,
          'alpha_coverage':results['alpha_coverage'],
          'half_alpha_fraction':results['half_transparent_fraction_of_atlas'],
          'normal_agreement':results['normal_agreement']},indent=2))
    return 0 if not failures else 1


if __name__=='__main__':
    sys.exit(main())
