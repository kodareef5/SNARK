#!/usr/bin/env python3
"""Independent delivered-file validation and review images for creeper.

Run after build_atlas.py. Requires Python 3, Pillow, numpy, scipy.
Checks the final assets and rebuilds every output in an isolated directory.
Failure returns a nonzero exit code and leaves checks/measurements.json.
"""
from pathlib import Path
import hashlib
import json
import struct
import shutil
import subprocess
import tempfile
import time
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage as ndi

ROOT=Path(__file__).resolve().parent
CHECKS=ROOT/'checks'
CHECKS.mkdir(exist_ok=True)
LANCZOS=Image.Resampling.LANCZOS


def font(size):
    for p in ['/System/Library/Fonts/Supplemental/Arial.ttf',
              '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf']:
        if Path(p).exists():return ImageFont.truetype(p,size)
    return ImageFont.load_default()


def png_info(path):
    head=path.read_bytes()[:29]
    width,height,bits,kind=struct.unpack('>IIBB',head[16:26])
    return {'width':width,'height':height,'bit_depth':bits,'colour_type':kind,
            'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}


def composite(base, background):
    a=base[:,:,3:4].astype(float)/255
    rgb=base[:,:,:3].astype(float)
    return Image.fromarray(np.rint(rgb*a+np.array(background)*(1-a)).astype(np.uint8))


def straight_resize(base, side):
    # Intentionally filter RGB independently of alpha, like the stated engine.
    rgb=Image.fromarray(base[:,:,:3]).resize((side,side),Image.Resampling.BOX)
    alpha=Image.fromarray(base[:,:,3]).resize((side,side),Image.Resampling.BOX)
    return np.dstack([np.asarray(rgb),np.asarray(alpha)])


def normal_reference(height, scale, range_mm, patch):
    # Independent central differences, not an import from the builder.
    h=height.astype(np.float64)*(range_mm/65535/1000)
    x0,y0,x1,y1=patch['rect']
    ph=height[y0:y1,x0:x1].astype(np.float64)*(patch['height_range_mm']/65535/1000)
    h[y0:y1,x0:x1]=0
    cards=h[:1536]
    dx=np.empty_like(cards);dy=np.empty_like(cards)
    dx[:,1:-1]=(cards[:,2:]-cards[:,:-2])*scale/2
    dx[:,0]=(cards[:,1]-cards[:,0])*scale
    dx[:,-1]=(cards[:,-1]-cards[:,-2])*scale
    dy[1:-1]=(cards[2:]-cards[:-2])*scale/2
    dy[0]=(cards[1]-cards[0])*scale
    dy[-1]=(cards[-1]-cards[-2])*scale
    band=h[1536:]
    bx=(np.roll(band,-1,axis=1)-np.roll(band,1,axis=1))*512
    by=np.empty_like(band)
    by[1:-1]=(band[2:]-band[:-2])*512
    by[0]=(band[1]-band[0])*1024
    by[-1]=(band[-1]-band[-2])*1024
    vectors=np.stack([-np.vstack([dx,bx]),np.vstack([dy,by]),np.ones_like(h)],axis=2)
    # One-sided boundary derivatives, with no sample crossing into a neighbour.
    pdx=np.empty_like(ph);pdy=np.empty_like(ph)
    sx=(x1-x0)/patch['metres'];sy=(y1-y0)/patch['metres']
    pdx[:,1:-1]=(ph[:,2:]-ph[:,:-2])*sx/2
    pdx[:,0]=(ph[:,1]-ph[:,0])*sx;pdx[:,-1]=(ph[:,-1]-ph[:,-2])*sx
    pdy[1:-1]=(ph[2:]-ph[:-2])*sy/2
    pdy[0]=(ph[1]-ph[0])*sy;pdy[-1]=(ph[-1]-ph[-2])*sy
    vectors[y0:y1,x0:x1]=np.stack([-pdx,pdy,np.ones_like(ph)],axis=2)
    return vectors/np.linalg.norm(vectors,axis=2,keepdims=True)


def lit_image(base, normal, orm, direction):
    n=normal.astype(float)/127.5-1
    n/=np.linalg.norm(n,axis=2,keepdims=True)
    light=np.array(direction,float);light/=np.linalg.norm(light)
    diffuse=np.maximum(0,np.sum(n*light,axis=2))
    rgb=base[:,:,:3].astype(float)/255
    linear=np.where(rgb<=.04045,rgb/12.92,((rgb+.055)/1.055)**2.4)
    shade=.23+.84*diffuse
    linear*=shade[:,:,None]*(orm[:,:,0:1]/255)**.65
    srgb=np.where(linear<=.0031308,linear*12.92,1.055*np.maximum(linear,0)**(1/2.4)-.055)
    rgba=np.dstack([np.rint(np.clip(srgb,0,1)*255).astype(np.uint8),base[:,:,3]])
    return composite(rgba,(42,43,45))


def check_mat(base,height,normal,orm,require):
    rgb=base[1536:,:,:3].astype(float)
    lum=np.sum(rgb*np.array([.2126,.7152,.0722]),axis=2)
    ao=orm[1536:,:,0]/255
    rough=orm[1536:,:,1]/255
    hh=height[1536:].astype(float)/65535*12
    low=lum<=np.percentile(lum,5)
    high=lum>=np.percentile(lum,80)
    n=normal[1536:].astype(float)/127.5-1
    tilt=np.degrees(np.arctan2(np.linalg.norm(n[:,:,:2],axis=2),n[:,:,2]))
    mean=rgb.mean((0,1));gap=rgb[low].mean(0)
    require(np.all(np.abs(mean-[30,42,14])<2),'mat mean shade colour')
    require(np.all(np.abs(gap-[10,16,6])<6),'mat gaps not black-green')
    require(float(lum.max())<71,'mat has bright leaf pixels')
    require(ao.min()>=.35 and ao.max()<=.60,'mat AO outside .35–.60')
    require(ao[low].mean()<ao[high].mean()-.12,'mat gaps lack occlusion')
    require(rough.min()>=.78 and rough.max()<=.83,'mat roughness not near .8')
    require(0<hh.min()<hh.max()<=1.25,'mat relief not shallow')
    require(np.percentile(tilt,99)<10 and tilt.max()<20,'mat normal too steep')
    return {'mean_rgb':mean.tolist(),'darkest_five_percent_mean_rgb':gap.tolist(),
            'max_luminance_srgb':float(lum.max()),'occlusion_range':[float(ao.min()),float(ao.max())],
            'occlusion_gaps':float(ao[low].mean()),'occlusion_faces':float(ao[high].mean()),
            'roughness_range':[float(rough.min()),float(rough.max())],
            'height_range_mm':[float(hh.min()),float(hh.max())],
            'normal_tilt_degrees_p50_p95_p99_max':np.percentile(tilt,[50,95,99,100]).tolist()}


def check_rebuild(spec,originals,require):
    """Build from only the declared inputs in an empty, isolated directory."""
    inputs=sorted(originals|{'build_spec.json','card_geometry.json','rubble_relief.json'})
    outputs=['creeper_'+kind+'.png' for kind in ['base','height','normal','orm']]
    outputs+=['layout.json','sprites.json','source/build_metadata.json']
    outputs+=['source/prepared/'+e['name']+suffix+'.png'
              for e in spec['elements'] for suffix in ['', '_leaf_ids']]
    outputs+=['source/prepared/rubble'+suffix+'.png'
              for suffix in ['', '_height', '_orm', '_stone_ids']]
    require({p.name for p in (ROOT/'source/prepared').iterdir()}==
            {Path(p).name for p in outputs if '/prepared/' in p},'prepared file inventory')
    started=time.monotonic()
    with tempfile.TemporaryDirectory(prefix='creeper-check-') as directory:
        target=Path(directory);(target/'source').mkdir()
        shutil.copy2(ROOT/'build_atlas.py',target/'build_atlas.py')
        for name in inputs:
            shutil.copy2(ROOT/'source'/name,target/'source'/name)
        result=subprocess.run([sys.executable,str(target/'build_atlas.py')],cwd=target,
                              text=True,capture_output=True,timeout=180)
        require(result.returncode==0,'isolated build failed: '+result.stderr[-2000:])
        files={}
        for name in outputs:
            delivered=ROOT/name;rebuilt=target/name
            a=hashlib.sha256(delivered.read_bytes()).hexdigest() if delivered.exists() else None
            b=hashlib.sha256(rebuilt.read_bytes()).hexdigest() if rebuilt.exists() else None
            equal=a is not None and a==b
            files[name]={'delivered_sha256':a,'rebuilt_sha256':b,'identical':equal}
            require(equal,name+' differs from isolated rebuild')
    report={'status':'PASS' if result.returncode==0 and all(f['identical'] for f in files.values()) else 'FAIL',
            'seconds':round(time.monotonic()-started,2),'inputs':inputs,'files':files}
    (CHECKS/'rebuild.json').write_text(json.dumps(report,indent=2)+'\n')
    return {'status':report['status'],'identical_files':sum(f['identical'] for f in files.values()),
            'total_files':len(files),'seconds':report['seconds']}


def main():
    layout=json.loads((ROOT/'layout.json').read_text())
    spec=json.loads((ROOT/'source/build_spec.json').read_text())
    failures=[]
    def require(ok,message):
        if not bool(ok):failures.append(message)
    files={k:png_info(ROOT/f'creeper_{k}.png') for k in ['base','height','normal','orm']}
    for k,info in files.items():
        require((info['width'],info['height'])==(2048,2048),k+' size')
        expected=(16,0) if k=='height' else (8,6) if k=='base' else (8,2)
        require((info['bit_depth'],info['colour_type'])==expected,k+' PNG format')
    if failures:
        report={'status':'FAIL','failures':failures,'files':files}
        (CHECKS/'measurements.json').write_text(json.dumps(report,indent=2)+'\n')
        print(json.dumps(report,indent=2))
        return 1
    base=np.asarray(Image.open(ROOT/'creeper_base.png'))
    height=np.asarray(Image.open(ROOT/'creeper_height.png'))
    normal=np.asarray(Image.open(ROOT/'creeper_normal.png'))
    orm=np.asarray(Image.open(ROOT/'creeper_orm.png'))
    alpha=base[:,:,3]
    require(np.all(orm[:,:,2]==0),'nonzero metalness')
    require(not (ROOT/'creeper_regions.png').exists(),'unexpected regions map')
    require(np.all(height[alpha==0]==0),'height outside alpha')
    require(np.all(orm[alpha==0]==[255,255,0]),'material outside alpha')
    require('srgb' in Image.open(ROOT/'creeper_base.png').info,'base sRGB declaration')
    for name in ['height','normal','orm']:
        require('srgb' not in Image.open(ROOT/f'creeper_{name}.png').info,name+' must be linear')
    require(set(e['name'] for e in layout['elements'])==
            {f'run{i}' for i in range(1,9)}|{'hang1','hang2','ground1','ground2','mat','rubble'},'element names')
    require(len(layout['elements'])==14,'duplicate elements')
    owner=np.zeros((2048,2048),np.uint8)
    metrics={}
    for index,e in enumerate(layout['elements'],1):
        name=e['name'];x0,y0,x1,y1=e['rect']
        bounds=0<=x0<x1<=2048 and 0<=y0<y1<=2048
        require(bounds,name+' rect bounds')
        if not bounds:continue
        require(not owner[y0:y1,x0:x1].any(),name+' overlapping rectangles')
        owner[y0:y1,x0:x1]=index
        aa=alpha[y0:y1,x0:x1]
        half=(aa>0)&(aa<255)
        entry={'alpha_coverage':float(np.mean(aa/255)),
               'opaque_pixels':int((aa==255).sum()),'transparent_pixels':int((aa==0).sum()),
               'partial_alpha_pixels':int(half.sum()),'partial_alpha_fraction_rect':float(half.mean()),
               'partial_alpha_fraction_surface':float(half.sum()/max(1,(aa>0).sum()))}
        if name=='mat':
            require(e.get('role')=='band' and e['rect']==[0,1536,2048,2048] and e['metres']==2.,'mat layout')
            require(np.all(aa==255),'mat transparency')
            metrics[name]=entry
            continue
        require(y1<=1536,name+' enters mat rows')
        if name=='rubble':
            require(e.get('role')=='patch' and e['metres']==2.4,'rubble role or physical width')
            require((x1-x0,y1-y0)==(600,600),'rubble must be 600px square')
            require(np.all(aa==255),'rubble is not fully opaque')
            require(e.get('height_range_mm')==60.,'rubble height decoding range')
            rough=orm[y0:y1,x0:x1,1]/255
            entry['roughness_min_max']=[float(rough.min()),float(rough.max())]
            require(rough.min()>=.85 and rough.max()<=.95,'rubble roughness outside .85–.95')
            hh=height[y0:y1,x0:x1]/65535*e['height_range_mm']
            entry['height_used_mm']=[float(hh.min()),float(hh.max())]
            entry['scale_px_per_m']=(x1-x0)/e['metres']
            entry['height_percentiles_mm']=np.percentile(hh,[5,50,95]).tolist()
            require(50<=hh.max()<=60 and hh.max()-hh.min()>40,'rubble lacks stone-scale relief')
            ao=orm[y0:y1,x0:x1,0]/255
            low=hh<np.percentile(hh,20);high=hh>np.percentile(hh,80)
            entry['ao_mean_gaps']=float(ao[low].mean())
            entry['ao_mean_faces']=float(ao[high].mean())
            require(entry['ao_mean_gaps']<entry['ao_mean_faces']-.15,'rubble gaps lack occlusion')
            metrics[name]=entry
            continue
        sy,sx=np.where(aa>0)
        require(bool(len(sx)),name+' empty alpha')
        if not len(sx):continue
        margins=[int(sx.min()),int(sy.min()),int(aa.shape[1]-1-sx.max()),int(aa.shape[0]-1-sy.max())]
        entry['margins_ltrb_px']=margins
        require(min(margins)>=24,name+' less than 24 px margin')
        for key in ['anchor','tip']:
            x,y=e[key]
            require(x0<=x<x1 and y0<=y<y1 and alpha[y,x]>=128,name+' '+key+' outside surface')
        a,t=e['anchor'],e['tip']
        require((t[1]>a[1]) if name.startswith('hang') else (t[1]<a[1]),name+' wrong growth direction')
        length=float(np.linalg.norm(np.array(t)-a)/layout['scale_px_per_m'])
        entry['anchor_tip_metres']=length
        require(abs(length-e['metres'])<.000001,name+' inconsistent metres')
        low,high=(.35,.55) if name.startswith('run') else (.60,.90)
        require(low<=length<=high,name+' physical length outside brief')
        # RGB bleed must agree with actual edge colours at least 32 px outward.
        rgb=base[y0:y1,x0:x1,:3].astype(float)
        dist,indices=ndi.distance_transform_edt(aa==0,return_indices=True)
        extended=rgb[indices[0],indices[1]]
        ring=(dist>0)&(dist<=32)
        error=np.abs(rgb[ring]-extended[ring])
        entry['rgb_bleed_32px_max_error']=float(error.max()) if error.size else 0
        require(entry['rgb_bleed_32px_max_error']<=1,name+' insufficient colour bleed')
        mean=rgb[aa>=128].mean(axis=0)
        far=dist>=48
        entry['far_rgb_mean_error']=float(np.max(abs(rgb[far]-mean))) if far.any() else 0
        require(entry['far_rgb_mean_error']<=.51,name+' background not element mean')
        # Partial alpha must be a one/two-pixel contour, not translucent blades.
        ds=ndi.distance_transform_edt(aa>=128)
        do=ndi.distance_transform_edt(aa<128)
        broad=half & np.where(aa>=128,ds>2.01,do>2.01)
        entry['partial_alpha_beyond_two_pixel_edge']=int(broad.sum())
        require(not broad.any(),name+' broad half-alpha haze')
        labels,count=ndi.label(aa>0,np.ones((3,3)))
        entry['connected_alpha_components']=int(count)
        require(count==1,name+' disconnected stems or alpha specks')
        require(entry['partial_alpha_fraction_rect']<.04,name+' excess partial alpha')
        metrics[name]=entry
    require(not np.any((alpha>0)&(owner==0)),'surface outside rectangles')
    # The final source manifest and sprite geometry stand on their own.
    require(layout['scale_px_per_m']==spec['scale_px_per_m']==1200,'card physical scale')
    require(layout['height_range_mm']==spec['height_range_mm']==12.,'plant height decoding range')
    specifications={e['name']:e for e in spec['elements']}
    specifications['mat']={'rect':[0,spec['mat_start_y'],spec['size'],spec['size']]}
    specifications['rubble']=spec['rubble']
    for element in layout['elements']:
        require(element['rect']==specifications[element['name']]['rect'],element['name']+' build/layout rectangle mismatch')
    metadata=json.loads((ROOT/'source/build_metadata.json').read_text())
    originals={e.get('source',e['name']+'_original.png') for e in spec['elements']}
    originals.update([spec['mat']['source'],spec['rubble']['source']])
    require(set(metadata['sources_sha256'])==originals,'source hash manifest')
    require({p.name for p in (ROOT/'source').glob('*_original.png')}==originals,'unused or missing original')
    for name in sorted(originals):
        path=ROOT/'source'/name
        require(hashlib.sha256(path.read_bytes()).hexdigest()==metadata['sources_sha256'][name],name+' source hash mismatch')
        with Image.open(path) as image:
            image.verify()
    sprites=json.loads((ROOT/'sprites.json').read_text())
    geometry=json.loads((ROOT/'source/card_geometry.json').read_text())
    require(sprites['size']==spec['size'],'sprite atlas size')
    require(set(sprites['elements'])==set(specifications),'sprite names')
    require(set(geometry)=={e['name'] for e in spec['elements']},'card geometry names')
    sprite_metrics={}
    for e in layout['elements']:
        name=e['name'];sp=sprites['elements'][name];x0,y0,x1,y1=e['rect']
        require(sp['name']==name and sp['role']==e.get('role','spray'),name+' sprite role')
        require(sp['metres']==e['metres'],name+' sprite physical scale')
        tile=base[y0:y1,x0:x1].astype(np.float32)/255
        if 'anchor' in e:
            for key,value in geometry[name].items():
                require(sp[key]==value,name+' sprite outline '+key)
            origin=np.array(e['anchor'],float)
            along=np.array(e['tip'],float)-origin;along/=np.linalg.norm(along)
            right=np.array([-along[1],along[0]])
            expected_origin=origin/[2048,-2048]+[0,1]
            require(np.allclose(sp['uv']['origin'],expected_origin,atol=1e-12,rtol=0),name+' sprite origin')
            for key,vector in [('along',along),('right',right)]:
                require(np.allclose(sp['uv'][key],vector*sp['length_px']/[2048,-2048],atol=1e-12,rtol=0),name+' sprite '+key)
            weight=tile[:,:,3:4]
            mean=(tile[:,:,:3]*weight).sum((0,1))/float(weight.sum())
            # Each saved card polygon must contain the visible silhouette.
            yy,xx=np.where(tile[:,:,3]>=.3)
            delta=np.stack([xx+x0+.5,yy+y0+.5],axis=1)-origin
            points=np.stack([np.sum(delta*right,axis=1),np.sum(delta*along,axis=1)],axis=1)/sp['length_px']
            polygon=np.array(sp['card']);edge=np.roll(polygon,-1,axis=0)-polygon
            cross=edge[:,0,None]*(points[None,:,1]-polygon[:,None,1])-edge[:,1,None]*(points[None,:,0]-polygon[:,None,0])
            orientation=np.sign(np.sum(polygon[:,0]*np.roll(polygon[:,1],-1)-polygon[:,1]*np.roll(polygon[:,0],-1)))
            clearance=cross*orientation/np.linalg.norm(edge,axis=1)[:,None]*sp['length_px']
            require(clearance.min()>=-1,name+' sprite polygon clips alpha')
            sprite_metrics[name]={'minimum_card_clearance_px':float(clearance.min())}
            rec=metadata['elements'][name];px,py=rec['placement'];w,h=rec['fitted_size']
            prepared=np.asarray(Image.open(ROOT/'source/prepared'/f'{name}.png'))
            require(prepared.shape==(h,w,4),name+' prepared size')
            delivered=base[py:py+h,px:px+w]
            require(np.array_equal(prepared[:,:,3],delivered[:,:,3]),name+' prepared alpha alignment')
            support=prepared[:,:,3]>0
            require(np.array_equal(prepared[support],delivered[support]),name+' prepared colour alignment')
        else:
            mean=tile[:,:,:3].mean((0,1))
            if name=='mat':
                require(sp['v']==[1-y1/2048,1-y0/2048],name+' sprite band UV')
            else:
                require(sp['uv']==[(x0+6)/2048,1-(y1-6)/2048,(x1-6)/2048,1-(y0+6)/2048],name+' sprite patch UV')
        require(np.allclose(sp['mean'],mean,atol=1e-7,rtol=0),name+' stale sprite mean colour')
    patch=next(e for e in layout['elements'] if e['name']=='rubble')
    reference=normal_reference(height,layout['scale_px_per_m'],spec['height_range_mm'],patch)
    decoded=normal.astype(float)/127.5-1
    decoded/=np.linalg.norm(decoded,axis=2,keepdims=True)
    angles=np.degrees(np.arccos(np.clip(np.sum(decoded*reference,axis=2),-1,1)))
    quantized=np.rint((reference+1)*127.5).astype(np.uint8)
    normal_error=int(np.max(abs(normal.astype(int)-quantized.astype(int))))
    require(normal_error<=1,'normal does not follow delivered height')
    require(float(angles.max())<.45,'normal angular error too large')
    seam={}
    for name,arr in [('base',base),('height',height),('normal',normal),('orm',orm)]:
        band=arr[1536:]
        delta=abs(band[:,0].astype(float)-band[:,-1].astype(float))
        seam[name]={'max_edge_difference':float(delta.max()),'mean_edge_difference':float(delta.mean())}
        require(delta.max()<=1,name+' horizontal mat seam')
    mat_material=check_mat(base,height,normal,orm,require)
    mat_lum=float(np.mean(np.sum(base[1536:,:,:3]*np.array([.2126,.7152,.0722]),axis=2)))
    cards=(alpha>=128).copy();cards[1536:]=False
    x0,y0,x1,y1=patch['rect'];cards[y0:y1,x0:x1]=False
    card_lum=float(np.mean(np.sum(base[:,:,:3]*np.array([.2126,.7152,.0722]),axis=2)[cards]))
    require(mat_lum<card_lum,'mat is not darker than runs')
    # Full-size backgrounds and deliberately alpha-independent 256px mips.
    mini=straight_resize(base,256)
    for label,bg in [('dark',(42,43,45)),('white',(255,255,255)),('green',(88,125,79))]:
        composite(base,bg).save(CHECKS/f'base_{label}_2048.png')
        composite(mini,bg).save(CHECKS/f'base_{label}_256.png')
    contact=Image.new('RGB',(768,282),(25,27,28));draw=ImageDraw.Draw(contact)
    for i,label in enumerate(['dark','white','green']):
        contact.paste(Image.open(CHECKS/f'base_{label}_256.png'),(i*256,26))
        draw.text((i*256+8,5),label+' / 256 px',font=font(15),fill='white')
    contact.save(CHECKS/'mip_backgrounds.png')
    # Every delivered layer, including alpha as a separate diagnostic panel.
    previews=[('BASE / sRGB',composite(base,(42,43,45))),
              ('HEIGHT / plants 0–12 mm; rubble 0–60 mm',Image.fromarray((height/257).astype(np.uint8)).convert('RGB')),
              ('NORMAL / OpenGL +Y',Image.fromarray(normal)),
              ('ORM / linear',Image.fromarray(orm))]
    layers=Image.new('RGB',(2048,2120),(24,25,27));d=ImageDraw.Draw(layers)
    for i,(title,im) in enumerate(previews):
        x=(i%2)*1024;y=(i//2)*1060
        d.text((x+14,y+8),title,font=font(22),fill='white')
        layers.paste(im.resize((1024,1024),LANCZOS),(x,y+36))
    layers.save(CHECKS/'layers.jpg',quality=95)
    Image.fromarray(alpha).save(CHECKS/'alpha.png')
    # Exact source coordinates, bounds and directed anchor-to-tip arrows.
    drawn=composite(base,(42,43,45));d=ImageDraw.Draw(drawn)
    for e in layout['elements']:
        x0,y0,x1,y1=e['rect'];d.rectangle((x0,y0,x1-1,y1-1),outline=(80,210,235),width=2)
        label=e['name']+f"  {e['metres']:.3f} m"
        d.text((x0+7,y0+7),label,font=font(19),fill=(255,255,255),stroke_width=1,stroke_fill=(0,0,0))
        if 'anchor' in e:
            a,t=e['anchor'],e['tip'];d.line((tuple(a),tuple(t)),fill=(230,210,70),width=1)
            for p,colour,tag in [(a,(255,117,55),'A'),(t,(60,220,255),'T')]:
                x,y=p;d.ellipse((x-5,y-5,x+5,y+5),fill=colour)
                d.text((x+8,y-9),tag,font=font(17),fill=colour)
    drawn.save(CHECKS/'layout.png')
    # Lit files retain each rectangle's native pixel resolution.
    (CHECKS/'lit').mkdir(exist_ok=True)
    light_a=lit_image(base,normal,orm,[-.65,.45,.65])
    light_b=lit_image(base,normal,orm,[.65,-.45,.65])
    light_a.save(CHECKS/'lit_left_2048.png');light_b.save(CHECKS/'lit_right_2048.png')
    sheet=Image.new('RGB',(1800,2080),(31,32,34));d=ImageDraw.Draw(sheet)
    for i,e in enumerate(layout['elements']):
        cell_x=(i%4)*450;cell_y=(i//4)*520
        d.text((cell_x+9,cell_y+7),e['name']+'   light A / light B',font=font(18),fill='white')
        for j,(name,whole) in enumerate([('left',light_a),('right',light_b)]):
            crop=whole.crop(tuple(e['rect']))
            crop.save(CHECKS/'lit'/f"{e['name']}_{name}.png")
            crop.thumbnail((220,478),LANCZOS)
            sheet.paste(crop,(cell_x+j*225+(220-crop.width)//2,cell_y+33+(478-crop.height)//2))
    sheet.save(CHECKS/'lit_elements.jpg',quality=95)
    rubble_sheet=Image.new('RGB',(1200,1272),(24,25,27));d=ImageDraw.Draw(rubble_sheet)
    for i,(title,im) in enumerate(previews):
        x=(i%2)*600;y=(i//2)*636
        d.text((x+10,y+8),title,font=font(17),fill='white')
        rubble_sheet.paste(im.crop(tuple(patch['rect'])),(x,y+36))
    rubble_sheet.save(CHECKS/'rubble_layers.jpg',quality=95)
    # Only full-resolution originals consumed by the final build.
    sources=[ROOT/'source'/name for name in sorted(originals)]
    source_sheet=Image.new('RGB',(1120,320*((len(sources)+3)//4)),(31,32,34))
    d=ImageDraw.Draw(source_sheet)
    for i,path in enumerate(sources):
        x=(i%4)*280;y=(i//4)*320
        im=Image.open(path).convert('RGBA');im.thumbnail((264,280),LANCZOS)
        source_sheet.paste(im,(x+(280-im.width)//2,y+32+(280-im.height)//2),im)
        d.text((x+8,y+8),path.stem,font=font(15),fill='white')
    source_sheet.save(CHECKS/'source_contact.jpg',quality=95)
    # A repeated horizontal band, with the join centred for visual review.
    band=composite(base,(42,43,45)).crop((0,1536,2048,2048))
    strip=Image.new('RGB',(4096,512))
    strip.paste(band,(0,0));strip.paste(band,(2048,0))
    strip.save(CHECKS/'mat_repeat.png')
    strip.crop((1792,0,2304,512)).save(CHECKS/'mat_seam_closeup.png')
    plant_height=height.copy()
    x0,y0,x1,y1=patch['rect'];plant_height[y0:y1,x0:x1]=0
    rebuild=check_rebuild(spec,originals,require)
    measures={'status':'PASS' if not failures else 'FAIL','failures':failures,
              'files':files,'scale_px_per_m':layout['scale_px_per_m'],
              'mat_px_per_m':1024,'height_full_range_mm':spec['height_range_mm'],
              'height_range_overrides_mm':{'rubble':patch['height_range_mm']},
              'plant_height_used_range_mm':[float(plant_height.min()/65535*spec['height_range_mm']),float(plant_height.max()/65535*spec['height_range_mm'])],
              'alpha_partial_fraction_atlas':float(((alpha>0)&(alpha<255)).mean()),
              'normal_against_height':{'max_quantized_channel_error':normal_error,
               'mean_angle_degrees':float(angles.mean()),'max_angle_degrees':float(angles.max()),
               'surface_mean_angle_degrees':float(angles[alpha>=128].mean())},
              'mat_horizontal_seam':seam,'mean_luminance_srgb':{'cards':card_lum,'mat':mat_lum},
              'sprites':sprite_metrics,'rebuild':rebuild,'mat_material':mat_material,
              'elements':metrics,'visual_review':'See REPORT.md; generated previews do not certify in-engine appearance.'}
    (CHECKS/'measurements.json').write_text(json.dumps(measures,indent=2)+'\n')
    print(json.dumps({'status':measures['status'],'failures':failures,
                      'normal_error':measures['normal_against_height'],
                      'partial_alpha_fraction':measures['alpha_partial_fraction_atlas'],
                      'luminance':measures['mean_luminance_srgb']},indent=2))
    return 1 if failures else 0


if __name__=='__main__':
    try:
        sys.exit(main())
    except (OSError,ValueError,KeyError,IndexError,TypeError,struct.error,subprocess.TimeoutExpired) as error:
        failure={'status':'FAIL','failures':[str(error)]}
        (CHECKS/'measurements.json').write_text(json.dumps(failure,indent=2)+'\n')
        print(json.dumps(failure,indent=2))
        sys.exit(1)
