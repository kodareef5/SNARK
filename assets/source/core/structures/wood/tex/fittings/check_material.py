#!/usr/bin/env python3
"""Independent delivery checks and physically scaled diagnostic relighting.
Uses saved PNGs only; does not import the builder's normal implementation.
"""
from pathlib import Path
import json, struct, hashlib
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy.ndimage import label, gaussian_filter, binary_erosion

ROOT=Path(__file__).resolve().parent
OUT=ROOT/'checks'; OUT.mkdir(exist_ok=True)
PASS1=ROOT/'source'/'pass1'
BEFORE=ROOT/'source'/'pass2'
N=2048; MM_PER_PIXEL=1000/2048; HEIGHT_RANGE_MM=12.0
BANDS=[(1024,1280),(1280,1408),(1408,1536),(1536,1664),(1664,1792),(1792,2048)]
FONT='/System/Library/Fonts/Supplemental/Arial.ttf'
def font(n):
    try: return ImageFont.truetype(FONT,n)
    except OSError: return ImageFont.load_default()

def load(name): return np.asarray(Image.open(ROOT/f'fittings_{name}.png'))
def srgb_to_linear(v): return np.where(v<=.04045,v/12.92,((v+.055)/1.055)**2.4)
def linear_to_srgb(v): return np.where(v<=.0031308,v*12.92,1.055*np.maximum(v,0)**(1/2.4)-.055)
def image8(a): return Image.fromarray(np.round(np.clip(a,0,255)).astype(np.uint8))
def label_image(im,text):
    im=im.convert('RGB'); out=Image.new('RGB',(im.width,im.height+42),(22,24,27))
    out.paste(im,(0,42)); ImageDraw.Draw(out).text((12,10),text,font=font(19),fill=(225,224,216))
    return out

def sheet(items,cols,path,thumb=(512,512),titles=None):
    blocks=[]
    for i,im in enumerate(items):
        if isinstance(im,np.ndarray): im=image8(im)
        im=im.resize(thumb,Image.Resampling.LANCZOS)
        blocks.append(label_image(im,titles[i] if titles else str(i+1)))
    w,h=blocks[0].size
    out=Image.new('RGB',(cols*w,((len(blocks)+cols-1)//cols)*h),(22,24,27))
    for i,b in enumerate(blocks): out.paste(b,((i%cols)*w,(i//cols)*h))
    out.save(path,quality=94)
    return out


def independent_normal(h):
    out=np.empty((2048,2048,3),np.float64)
    patches=[(y,y+512,x,x+512,False) for y in (0,512) for x in range(0,2048,512)]
    patches += [(a,b,0,2048,True) for a,b in BANDS]
    for a,b,c,d,periodic in patches:
        z=h[a:b,c:d].astype(np.float64)*12/65535
        gx=np.empty_like(z); gy=np.empty_like(z)
        gx[:,1:-1]=(z[:,2:]-z[:,:-2])/(2*MM_PER_PIXEL)
        gy[1:-1]=(z[2:]-z[:-2])/(2*MM_PER_PIXEL)
        gy[0]=(z[1]-z[0])/MM_PER_PIXEL
        gy[-1]=(z[-1]-z[-2])/MM_PER_PIXEL
        if periodic:
            gx[:,0]=(z[:,1]-z[:,-1])/(2*MM_PER_PIXEL)
            gx[:,-1]=(z[:,0]-z[:,-2])/(2*MM_PER_PIXEL)
        else:
            gx[:,0]=(z[:,1]-z[:,0])/MM_PER_PIXEL
            gx[:,-1]=(z[:,-1]-z[:,-2])/MM_PER_PIXEL
        v=np.stack([-gx,gy,np.ones_like(z)],-1)
        out[a:b,c:d]=v/np.sqrt(np.sum(v*v,axis=-1))[...,None]
    return out


def relight(base,n8,orm,direction):
    """Simple orthographic GGX material preview, two area-light orientations.
    Linear workflow, view (0,0,1), white broad area key and ambient environment.
    AO is only used for ambient. No AO or highlights are added to albedo files.
    """
    n=n8.astype(np.float32)/255*2-1
    n/=np.maximum(np.linalg.norm(n,axis=-1,keepdims=True),1e-6)
    c=srgb_to_linear(base.astype(np.float32)/255)
    ao=orm[...,0:1].astype(np.float32)/255
    rough=orm[...,1:2].astype(np.float32)/255
    metal=orm[...,2:3].astype(np.float32)/255
    f0=.04*(1-metal)+c*metal
    result=(c*(1-metal)*.30+f0*(.39-.10*rough))*ao
    nv=np.clip(n[...,2:3],.015,1)
    alpha=rough**2
    a2=alpha**2
    key=np.array(direction,dtype=np.float32); key/=np.linalg.norm(key)
    # Sample a broad square emitter: enough angular width to reveal forged planes.
    for u in (-.18,0,.18):
        for v in (-.18,0,.18):
            l=key+np.array([u,v,0],np.float32);l/=np.linalg.norm(l)
            halfway=l+np.array([0,0,1]);halfway/=np.linalg.norm(halfway)
            nl=np.clip((n*l).sum(-1,keepdims=True),0,1)
            nh=np.clip((n*halfway).sum(-1,keepdims=True),0,1)
            vh=float(halfway[2])
            D=a2/(np.pi*(nh*nh*(a2-1)+1)**2+1e-6)
            k=(rough+1)**2/8
            G=(nv/(nv*(1-k)+k))*(nl/(nl*(1-k)+k+1e-6))
            F=f0+(1-f0)*(1-vh)**5
            spec=D*G*F/(4*nv*np.maximum(nl,.001)+1e-6)
            diffuse=(1-F)*(1-metal)*c/np.pi
            result+=(diffuse+spec)*nl*(3.5/9)
    return np.round(np.clip(linear_to_srgb(result),0,1)*255).astype(np.uint8)


def main():
    base=load('base'); h=load('height'); normal=load('normal'); orm=load('orm')
    metrics={}
    metrics['files']={}
    for name in ['base','height','normal','orm']:
        p=ROOT/f'fittings_{name}.png'; raw=p.read_bytes(); im=Image.open(p)
        width,height,depth,color_type=struct.unpack('>IIBB',raw[16:26])
        metrics['files'][p.name]={'size':[width,height],'bit_depth':depth,'png_color_type':color_type,'mode':im.mode,
                                  'icc_profile':bool(im.info.get('icc_profile')),'sha256':hashlib.sha256(raw).hexdigest()}
        assert (width,height)==(N,N)
        assert depth==(16 if name=='height' else 8)
        assert color_type==(0 if name=='height' else 2)
        assert bool(im.info.get('icc_profile'))==(name=='base')
    expected=independent_normal(h)
    actual=normal.astype(np.float64)/255*2-1
    normlength=np.linalg.norm(actual,axis=-1)
    actual/=normlength[...,None]
    angle=np.degrees(np.arccos(np.clip((actual*expected).sum(-1),-1,1)))
    expected_rgb=np.round((expected*.5+.5)*255).astype(np.uint8)
    metrics['normal']={'mean_angle_degrees':float(angle.mean()),'p99_angle_degrees':float(np.percentile(angle,99)),
                       'max_angle_degrees':float(angle.max()),'max_channel_difference_from_independent_recompute':int(np.abs(normal.astype(int)-expected_rgb.astype(int)).max()),
                       'mean_decoded_length':float(normlength.mean())}
    assert angle.max()<.41
    metrics['height']={'full_encoding_mm':12.0,'used_min_mm':float(h.min()/65535*12),'used_max_mm':float(h.max()/65535*12)}
    metrics['wood_mean_srgb']=base[:1024].mean(axis=(0,1)).tolist()
    assert np.all(orm[:1024,:,2]==0)
    metrics['wood_nonzero_metalness_pixels']=int(np.count_nonzero(orm[:1024,:,2]))
    masks={k:np.asarray(Image.open(ROOT/'source'/f'{k}_mask.png')) for k in ['check','peg','rust','pits','head']}
    metrics['rust_metalness_error_max']=int(np.abs(orm[1024:,:,2].astype(int)-(255-masks['rust'][1024:].astype(int))).max())
    assert metrics['rust_metalness_error_max']<=1
    metrics['bare_iron_metalness_min']=int(orm[1024:,:,2][masks['rust'][1024:]==0].min())
    assert metrics['bare_iron_metalness_min']==255
    metrics['head_interior_metalness_min']=int(orm[...,2][masks['head']==255].min())
    assert metrics['head_interior_metalness_min']==255
    metrics['rust_interior_roughness_mean']=float(orm[...,1][masks['rust']==255].mean()/255)
    metrics['check_AO_mean']=float(orm[...,0][masks['check']>240].mean()/255)
    metrics['peg_count']=int(label(masks['peg']>127)[1]); assert metrics['peg_count']==3
    metrics['fasteners']=[]
    head_ids,count=label(masks['head']>127); assert count==16
    for i in range(1,count+1):
        ys,xs=np.where(head_ids==i); x=float(xs.mean()); y=float(ys.mean())
        cx=round(x); cy=round(y)
        typ='rivet' if y<1408 else 'square nail'
        expected_y=1343.5 if typ=='rivet' else 1599.5
        assert abs(y-expected_y)<.02 and min(abs(x-z) for z in range(128,2048,256))<.02
        metrics['fasteners'].append({'type':typ,'centroid_xy':[x,y],'bbox_size_px':[int(np.ptp(xs)+1),int(np.ptp(ys)+1)],
                                     'crown_height_mm':float(h[cy,cx]/65535*12)})
    metrics['arris']={}
    for i in range(8):
        a=(i//4)*512;b=(i%4)*512
        cell=base[a:a+512,b:b+512]; yy,xx=np.mgrid[:512,:512]; rim=np.minimum.reduce([yy,xx,511-yy,511-xx])<=3
        assert np.unique(cell[rim],axis=0).shape[0]==1
        for k in ['check','peg']:
            assert np.max(masks[k][a:a+512,b:b+512][rim])==0
        metrics['arris'][str(i+1)]={'clean_margin_px':4,'color_srgb':cell[0,0].tolist()}
    # Exact source-to-atlas placement checked separately from visual grid lines.
    manifest=json.loads((ROOT/'source'/'manifest.json').read_text())
    assembly=[]
    for i in range(8):
        yy=(i//4)*512;xx=(i%4)*512
        assembly.append((f'endgrain_{i+1:02d}',yy,yy+512,xx,xx+512))
    for i,band in enumerate(manifest['iron_bands']):
        a,b=band['rows_inclusive']
        assembly.append((f'iron_{i+1:02d}_{band["name"]}',a,b+1,0,2048))
    metrics['source_assembly_max_channel_difference']={}
    for name,arr in [('base',base),('height',h),('orm',orm)]:
        errors=[]
        for stem,a,b,c,d in assembly:
            source=np.asarray(Image.open(ROOT/'source'/f'{stem}_{name}.png')).astype(np.int32)
            errors.append(int(np.abs(source-arr[a:b,c:d].astype(np.int32)).max()))
        metrics['source_assembly_max_channel_difference'][name]=max(errors)
        assert max(errors)<=1
    bare_pixels=base[1024:][masks['rust'][1024:]==0]
    metrics['bare_iron_srgb_mean']=bare_pixels.mean(axis=0).tolist()
    metrics['bare_iron_srgb_percentiles_5_95']=np.percentile(bare_pixels,[5,95],axis=0).tolist()
    # Pass-two acceptance: original atlas/head/peg layout and iron head geometry.
    baseline_hashes=json.loads((PASS1/'baseline_hashes.json').read_text())
    for name,digest in baseline_hashes.items():
        assert hashlib.sha256((PASS1/name).read_bytes()).hexdigest()==digest
    pass1_height=np.asarray(Image.open(PASS1/'fittings_height.png'))
    old_manifest=json.loads((PASS1/'source'/'manifest.json').read_text())
    for key in ['size_px','metres_per_tile','mm_per_pixel','height_range_mm','wood_cells','iron_bands','fasteners']:
        assert manifest[key]==old_manifest[key],key
    for key in ['head','peg']:
        assert np.array_equal(masks[key],np.asarray(Image.open(PASS1/'source'/f'{key}_mask.png')))
    head_delta=np.abs(h.astype(np.int32)-pass1_height.astype(np.int32))[binary_erosion(masks['head']==255)]
    assert int(head_delta.max())==0
    head_with_shoulder=np.abs(h.astype(np.int32)-pass1_height.astype(np.int32))[masks['head']==255]
    assert int(head_with_shoulder.max())<=1
    metrics['pass2']={'baseline_hashes_verified':True,'layout_matches_pass1':True,
                      'head_and_peg_masks_match_pass1':True,'head_interior_height_difference_codes':int(head_delta.max()),
                      'head_height_difference_including_quantized_shoulder_codes':int(head_with_shoulder.max())}
    rust=masks['rust'][1024:].astype(float)/255
    metrics['pass2']['iron_area_with_rust_below_50_percent']=float(np.mean(rust<.5))
    metrics['pass2']['iron_area_with_rust_below_25_percent']=float(np.mean(rust<.25))
    metrics['pass2']['iron_area_with_at_most_10_percent_rust']=float(np.mean(rust<=.10))
    metrics['pass2']['fractional_rust_coverage']=float(rust.mean())
    assert np.mean(rust<.5)>.80
    assert .80<np.mean(rust<=.10)<.85
    assert np.all((bare_pixels.mean(axis=0)>55)&(bare_pixels.mean(axis=0)<70))
    # Pass three is colour-only: verify every physical map and construction mask
    # byte-for-byte against the actual pre-edit delivery, plus layout and iron.
    baseline_hashes=json.loads((BEFORE/'baseline_hashes.json').read_text())
    for name,digest in baseline_hashes.items():
        assert hashlib.sha256((BEFORE/name).read_bytes()).hexdigest()==digest,name
    locked_hashes=json.loads((BEFORE/'locked_hashes.json').read_text())
    for name,digest in locked_hashes.items():
        assert hashlib.sha256((ROOT/name).read_bytes()).hexdigest()==digest,name
    before={name:np.asarray(Image.open(BEFORE/f'fittings_{name}.png')) for name in ['base','height','normal','orm']}
    pass2_manifest=json.loads((BEFORE/'source'/'manifest.json').read_text())
    for key in ['seed','size_px','metres_per_tile','mm_per_pixel','height_range_mm','height_zero_mm','normal_convention','wood_cells','iron_bands','fasteners']:
        assert manifest[key]==pass2_manifest[key],key
    assert np.array_equal(base[1024:],before['base'][1024:])
    assert np.all(np.abs(np.asarray(metrics['wood_mean_srgb'])-[186,149,107])<2)
    peg_mean=base[masks['peg']==255].mean(axis=0)
    assert np.all(np.abs(peg_mean-[177,142,96])<1)
    yy,xx=np.mgrid[:1024,:2048]
    edge=np.minimum.reduce([yy%512,xx%512,511-yy%512,511-xx%512])
    face_mean=base[:1024][(edge>=24)&(masks['peg'][:1024]==0)].mean(axis=0)
    assert np.all(np.abs(face_mean-[186,149,107])<4)
    for arris in metrics['arris'].values():
        assert np.all(np.asarray(arris['color_srgb'])<face_mean-10)
    # A constant pigment lift preserves ring, pore, saw and wear contrast.
    wood_delta=base[:1024].astype(np.int16)-before['base'][:1024].astype(np.int16)
    pigment_error=int(np.abs(wood_delta[masks['peg'][:1024]==0]-[91,83,63]).max())
    assert pigment_error<=1
    metrics['pass3']={'baseline_hashes_verified':True,'layout_matches_pass2':True,
        'unchanged_map_and_mask_files':len(locked_hashes),'locked_sha256':locked_hashes,
        'iron_base_pixel_identical':True,'wood_target_srgb':[186,149,107],
        'wood_face_interior_mean_srgb':face_mean.tolist(),'peg_target_srgb':[177,142,96],
        'peg_interior_mean_srgb':peg_mean.tolist(),'max_wood_pigment_shift_error_codes':pigment_error,
        'before_wood_mean_srgb':before['base'][:1024].mean(axis=(0,1)).tolist(),
        'before_peg_interior_mean_srgb':before['base'][masks['peg']==255].mean(axis=0).tolist()}
    cavity=np.asarray(Image.open(ROOT/'source'/'cavity_mask.png'))
    edgewear=np.asarray(Image.open(ROOT/'source'/'edgewear_mask.png'))
    metrics['pass2']['bands']=[]
    for i,(a,b) in enumerate(BANDS):
        r=masks['rust'][a:b].astype(float)/255
        c=cavity[a:b].astype(float)/255
        lower=float(r[-20:-4].mean()); upper=float(r[4:20].mean())
        assert lower>upper
        assert r[c>.8].mean()>r[c<.2].mean()
        wear=edgewear[a:b]>180
        dark_edge=float(base[[a,b-1]].mean()); worn=float(base[a:b][wear].mean())
        assert worn>dark_edge+15
        metrics['pass2']['bands'].append({'band':i+1,'fractional_rust_coverage':float(r.mean()),
            'rust_dominant_area':float(np.mean(r>=.5)),'lower_edge_rust_mean':lower,'upper_edge_rust_mean':upper,
            'deep_hammer_rust_mean':float(r[c>.8].mean()),'shallow_hammer_rust_mean':float(r[c<.2].mean()),
            'dark_boundary_mean_srgb':dark_edge,'worn_bevel_mean_srgb':worn})
    metrics['seams']=[]
    maps={'base':base,'height':h,'normal':normal,'orm':orm}
    for band,(a,b) in enumerate(BANDS):
        entry={'band':band+1,'rows':[a,b-1]}
        for name,arr in maps.items():
            z=arr[a:b].astype(np.float64)
            seam=np.abs(z[:,0]-z[:,-1])
            interior=np.abs(np.diff(z,axis=1))
            axes=(0,) if z.ndim==2 else (0,2)
            diffs=interior.mean(axis=axes)
            entry[name]={'wrap_mean':float(seam.mean()),'interior_mean':float(interior.mean()),'interior_column_p95':float(np.percentile(diffs,95)),
                         'wrap_vs_interior_p95':float(seam.mean()/(np.percentile(diffs,95)+1e-9))}
            assert entry[name]['wrap_vs_interior_p95']<2
        metrics['seams'].append(entry)
    (OUT/'metrics.json').write_text(json.dumps(metrics,indent=2)+'\n')
    # Native-resolution lit renders, retained before contact-sheet downsampling.
    lit_a=relight(base,normal,orm,(-.55,.48,.80));lit_b=relight(base,normal,orm,(.55,-.48,.80))
    image8(lit_a).save(OUT/'lit_upper_left.png');image8(lit_b).save(OUT/'lit_lower_right.png')
    hview=np.repeat((h/257).astype(np.uint8)[...,None],3,axis=2)
    layers=sheet([base,hview,normal,orm],4,OUT/'layers.jpg',thumb=(640,640),titles=['BASE / sRGB reflectance','HEIGHT / 0-12 mm','NORMAL / OpenGL','ORM / linear R G B'])
    relighting=sheet([lit_a,lit_b],2,OUT/'relighting.jpg',thumb=(1024,1024),titles=['GGX preview / upper-left area light','GGX preview / lower-right area light'])
    cells=[lit_a[(i//4)*512:(i//4+1)*512,(i%4)*512:(i%4+1)*512] for i in range(8)]
    sheet(cells,4,OUT/'endgrain_cells.jpg',thumb=(512,512),titles=[f'{i+1:02d} / '+['boxed heart','off-centre + peg','off-centre','quarter-sawn','boxed heart + peg','off-centre','off-centre + peg','boxed heart'][i] for i in range(8)])
    sheet([base[(i//4)*512:(i//4+1)*512,(i%4)*512:(i%4+1)*512] for i in range(8)],4,OUT/'endgrain_unlit.jpg',thumb=(512,512),titles=[f'CELL {i+1} / unlit base' for i in range(8)])
    before_lit=relight(before['base'],before['normal'],before['orm'],(-.55,.48,.80))
    comparison=sheet([before['base'],base,before_lit,lit_a],2,OUT/'before_after.jpg',thumb=(1024,1024),
        titles=['PASS 2 / unlit base','PASS 3 / unlit base','PASS 2 / identical GGX light A','PASS 3 / identical GGX light A'])
    detail=[]; detail_titles=[]
    for a,b,c,d,name in [(0,512,512,1024,'off-centre heart + peg'),(512,1024,0,512,'boxed heart + peg'),(1536,2048,0,512,'nail, strap, plate')]:
        for rev,arr in [('PASS 2',before['base']),('PASS 3',base)]:
            detail.append(arr[a:b,c:d]); detail_titles.append(f'{rev} / {name} / unlit')
    sheet(detail,2,OUT/'before_after_detail.jpg',thumb=(768,768),titles=detail_titles)
    # All bands get a native-resolution half-period offset. Center is old seam.
    for name,arr in [('base',base),('normal',normal),('orm',orm),('height',hview),('lit',lit_a)]:
        z=np.roll(arr[1024:],1024,axis=1)
        image8(z).save(OUT/f'iron_offset_{name}.png')
        image8(np.tile(arr[1024:],(1,3,1))).save(OUT/f'iron_3x_{name}.png')
    offsetitems=[]; offsettitles=[]
    for i,(a,b) in enumerate(BANDS):
        z=np.roll(lit_a[a:b],1024,axis=1)
        # Show join at 1:1 in a 512px-wide crop with no line obscuring it.
        crop=z[:,768:1280]
        offsetitems.append(Image.fromarray(crop).resize((1024,(b-a)*2),Image.Resampling.NEAREST))
        offsettitles.append(f'Band {i+1}: old wrap join at center / 200%')
    # Variable-height stack: no distortion of the band height.
    total=sum(im.height+42 for im in offsetitems); offsets=Image.new('RGB',(1024,total),(22,24,27)); yp=0
    for im,title in zip(offsetitems,offsettitles):
        block=label_image(im,title);offsets.paste(block,(0,yp));yp+=block.height
    offsets.save(OUT/'seam_closeups.jpg',quality=95)
    tiled=sheet([np.tile(base[1024:],(1,3,1)),np.tile(lit_a[1024:],(1,3,1))],1,OUT/'iron_tiling.jpg',thumb=(2048,341),titles=['IRON / three horizontal repeats / unlit','IRON / three horizontal repeats / upper-left light'])
    # Exact layout overlay, only in diagnostics.
    layout=Image.fromarray(base.copy()); dr=ImageDraw.Draw(layout)
    for x in (0,512,1024,1536,2047): dr.line((x,0,x,1023),fill=(85,232,197),width=2)
    for y in (0,512,1024,1280,1408,1536,1664,1792,2047): dr.line((0,y,2047,y),fill=(85,232,197),width=2)
    for j in range(8):dr.text(((j%4)*512+27,(j//4)*512+25),f'CELL {j+1} / 512 x 512',font=font(24),fill=(230,230,215))
    for j,(a,b) in enumerate(BANDS):dr.text((26,a+12),f'{a}-{b-1}',font=font(22),fill=(229,235,218))
    for y in (1343.5,1599.5):
        for x in range(128,2048,256):
            dr.ellipse((x-24,y-24,x+24,y+24),outline=(249,211,114),width=2)
            dr.line((x-5,y,x+5,y),fill=(249,211,114));dr.line((x,y-5,x,y+5),fill=(249,211,114))
    layout.resize((1024,1024),Image.Resampling.LANCZOS).save(OUT/'layout.jpg',quality=95)
    # Fastener crops, 4x, across the layers and both lights.
    cropitems=[]; croptitles=[]
    for y,kind in [(1344,'RIVET'),(1600,'NAIL')]:
        for title,z in [('base',base),('height',hview),('normal',normal),('ORM',orm),('light A',lit_a),('light B',lit_b)]:
            cropitems.append(z[y-48:y+48,80:176]);croptitles.append(kind+' / '+title)
    sheet(cropitems,6,OUT/'fastener_detail.jpg',thumb=(320,320),titles=croptitles)
    # Downsampled strap seen at distance alongside its native density.
    distance=Image.new('RGB',(1280,660),(34,36,39));d=ImageDraw.Draw(distance)
    d.text((24,18),'RIVETED STRAP / 1 m x 6.25 cm',font=font(26),fill=(229,230,225))
    for j,w in enumerate([1024,512,256]):
        im=Image.fromarray(lit_a[1280:1408]).resize((w,w//16),Image.Resampling.LANCZOS)
        yp=92+j*180;distance.paste(im,(24,yp));d.text((24,yp+im.height+12),f'{w} px per metre / area-filtered normal-lit result',font=font(19),fill=(185,189,191))
    distance.save(OUT/'distance_read.jpg',quality=95)
    # One review contact sheet includes every requested type of check.
    overview=Image.new('RGB',(1920,2620),(22,24,27))
    d=ImageDraw.Draw(overview);d.text((25,20),'FITTINGS  /  1 METRE  /  2048 PX  /  NATIVE PROCEDURAL PBR',font=font(30),fill=(236,230,212))
    overview.paste(layers.resize((1920,512),Image.Resampling.LANCZOS),(0,74))
    la=label_image(Image.fromarray(lit_a).resize((640,640),Image.Resampling.LANCZOS),'AREA LIGHT A');lb=label_image(Image.fromarray(lit_b).resize((640,640),Image.Resampling.LANCZOS),'AREA LIGHT B')
    overview.paste(la,(0,605));overview.paste(lb,(640,605));overview.paste(label_image(layout.resize((640,640),Image.Resampling.LANCZOS),'EXACT CELL / BAND / HEAD ALIGNMENT'),(1280,605))
    overview.paste(tiled.resize((1920,718),Image.Resampling.LANCZOS),(0,1306))
    oa=label_image(Image.fromarray(np.roll(base[1024:],1024,axis=1)).resize((960,480),Image.Resampling.LANCZOS),'ALL SIX BANDS / HALF-OFFSET / UNLIT')
    ob=label_image(Image.fromarray(np.roll(lit_a[1024:],1024,axis=1)).resize((960,480),Image.Resampling.LANCZOS),'ALL SIX BANDS / HALF-OFFSET / LIT')
    overview.paste(oa,(0,2042));overview.paste(ob,(960,2042))
    d.text((22,2580),'Native crops, all half-offset maps, three-repeat maps, two lights, and numerical verification retained in checks/.',font=font(20),fill=(192,195,194))
    # Put an honest same-scale/same-light before-and-after in the contact sheet.
    compare_strip=sheet([before['base'],base,before_lit,lit_a],4,OUT/'before_after_strip.jpg',thumb=(480,480),
        titles=['PASS 2 / BASE','PASS 3 / BASE','PASS 2 / LIGHT A','PASS 3 / LIGHT A'])
    contact=Image.new('RGB',(1920,overview.height+compare_strip.height+64),(22,24,27))
    ImageDraw.Draw(contact).text((25,15),'THIRD PASS / BASE COLOUR ONLY / SAME LAYOUT, EXPOSURE AND LIGHT',font=font(29),fill=(236,230,212))
    contact.paste(compare_strip,(0,64));contact.paste(overview,(0,64+compare_strip.height))
    contact.save(OUT/'contact_sheet.jpg',quality=95)
    print(json.dumps({k:v for k,v in metrics.items() if k not in ['files','arris','fasteners','seams']},indent=2))
    print('seam ratios (base,height,normal,orm):')
    for e in metrics['seams']: print(e['band'],[round(e[k]['wrap_vs_interior_p95'],3) for k in ['base','height','normal','orm']])
    print('All assertions passed. All diagnostics saved.')

if __name__=='__main__': main()
