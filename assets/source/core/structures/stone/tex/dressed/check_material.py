#!/usr/bin/env python3
"""Independent checks and visual proofs for the delivered PNGs.

Never modifies the material. Diagnostic lighting is only written in checks/.
"""
from pathlib import Path
import hashlib
import json
import struct

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy.ndimage import gaussian_filter
from scipy.spatial import cKDTree

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "checks"
OUT.mkdir(exist_ok=True)
N = 2048
TARGET = np.array([206, 198, 180])
LABEL = (225, 225, 218)
BG = (29, 31, 32)
try:
    FONT = ImageFont.truetype("/System/Library/Fonts/Menlo.ttc", 16)
    SMALL = ImageFont.truetype("/System/Library/Fonts/Menlo.ttc", 13)
except OSError:
    FONT = SMALL = ImageFont.load_default()


def rgb(a):
    return Image.fromarray(np.clip(np.rint(a), 0, 255).astype(np.uint8)).convert("RGB")


def save(im, name):
    im.save(OUT/name, quality=95, subsampling=0)


def sheet(images, titles, cols, size, filename):
    rows = (len(images)+cols-1)//cols
    canvas = Image.new("RGB", (cols*size, rows*(size+38)), BG)
    d = ImageDraw.Draw(canvas)
    for i, (im, title) in enumerate(zip(images,titles)):
        x, y = (i%cols)*size, (i//cols)*(size+38)
        d.text((x+12,y+11),title,font=FONT,fill=LABEL)
        canvas.paste(im.resize((size,size),Image.Resampling.LANCZOS),(x,y+38))
    save(canvas,filename)


def to_linear(a):
    a = a/255
    return np.where(a<=.04045,a/12.92,((a+.055)/1.055)**2.4)


def to_srgb(a):
    return np.where(a<=.0031308,12.92*a,1.055*np.maximum(a,0)**(1/2.4)-.055)*255


def light(base, normal, vector):
    l = np.array(vector,dtype=float)
    l /= np.linalg.norm(l)
    cosine = np.maximum(0,np.sum(normal*l,axis=2))
    # Linear-light Lambertian preview: fixed ambient, no exaggerated normals.
    return rgb(to_srgb(to_linear(base)*(.30+.96*cosine[...,None])))


def wrapped_crop(a,x,y,w,h):
    return a[np.ix_((y+np.arange(h))%N,(x+np.arange(w))%N)]


def seam_stats(a):
    a=a.astype(np.float64)
    result={}
    for axis,key in ((1,"x"),(0,"y")):
        jump=np.abs(np.take(a,0,axis=axis)-np.take(a,-1,axis=axis))
        interior=np.abs(np.diff(a,axis=axis))
        mean_axes=tuple(i for i in range(a.ndim) if i!=axis)
        line_means=interior.mean(axis=mean_axes)
        result[key]={"wrap_mean":float(jump.mean()),
                     "interior_mean":float(interior.mean()),
                     "interior_line_p95":float(np.percentile(line_means,95)),
                     "wrap_over_interior":float(jump.mean()/max(interior.mean(),1e-9)),
                     "wrap_max":float(jump.max())}
    return result


def main():
    names=["base","height","normal","orm"]
    ims={k:Image.open(ROOT/f"dressed_{k}.png") for k in names}
    arrays={k:np.asarray(im) for k,im in ims.items()}
    base=arrays['base'].astype(np.float64)
    h=arrays['height'].astype(np.float64)/65535*6.0
    normal=arrays['normal'].astype(np.float64)/255*2-1
    lengths=np.linalg.norm(normal,axis=2)
    normal/=lengths[...,None]
    orm=arrays['orm']/255
    height_vis=rgb(h/6*255)
    images=[ims['base'],height_vis,ims['normal'],ims['orm']]
    titles=["BASE / sRGB", "HEIGHT / 0-6 mm", "NORMAL / OpenGL", "ORM / linear"]
    sheet(images,titles,4,640,"layers.jpg")
    offset=[Image.fromarray(np.roll(np.roll(np.asarray(im),N//2,0),N//2,1)) for im in images]
    sheet(offset,[t+" / half offset" for t in titles],4,768,"offset.jpg")
    for key,im in zip(names,offset):
        im.save(OUT/f"offset_{key}.png")
    small=ims['base'].resize((640,640),Image.Resampling.LANCZOS)
    tile=Image.new("RGB",(1920,1920))
    for y in range(3):
        for x in range(3): tile.paste(small,(640*x,640*y))
    save(tile,"tiled3x3.jpg")

    directions=[(-1,0,.48),(1,0,.48),(0,1,.48),(0,-1,.48)]
    relit=[light(base,normal,v) for v in directions]
    sheet(relit,["LIGHT FROM LEFT", "LIGHT FROM RIGHT", "LIGHT FROM TOP", "LIGHT FROM BOTTOM"],2,900,"relit.jpg")

    # Twelve independently sampled rectangles, including two forced wrap cuts.
    # Each pair is exactly the same crop: flat colour above, physical relight
    # below. Borders are only a preview frame, never part of the texture.
    rng=np.random.default_rng(8007)
    blocks=[]
    canvas=Image.new("RGB",(1800,2100),BG)
    d=ImageDraw.Draw(canvas)
    lit=np.asarray(light(base,normal,(-1,1,.60)))
    fields=np.load(ROOT/"derivation.npz")
    for i in range(12):
        wm=float(rng.uniform(.25,1.0)); hm=float(rng.uniform(.25,min(.72,wm+.20)))
        if i==0: wm,hm=.25,.25
        if i==11: wm,hm=1.0,.66
        w,hp=round(wm/3*N),round(hm/3*N)
        x,y=map(int,rng.integers(0,N,2))
        if i==2: x=N-80
        if i==7: y=N-45
        b=wrapped_crop(arrays['base'],x,y,w,hp)
        l=wrapped_crop(lit,x,y,w,hp)
        # Same display scale for all faces, 386 display pixels per metre.
        dw,dh=round(wm*386),round(hm*386)
        col,row=i%4,i//4
        ox,oy=col*450,row*700
        d.text((ox+20,oy+14),f"{i+1:02d}  {wm:.2f} x {hm:.2f} m",font=FONT,fill=LABEL)
        for a,label,top in ((b,"ALBEDO",oy+64),(l,"RELIT",oy+394)):
            d.text((ox+20,top-20),label,font=SMALL,fill=(153,158,159))
            px=ox+(450-dw)//2
            d.rectangle((px-2,top-2,px+dw+2,top+dh+2),fill=(112,114,111))
            canvas.paste(rgb(a).resize((dw,dh),Image.Resampling.LANCZOS),(px,top))
        tool=wrapped_crop(fields['tool_depth_mm'],x,y,w,hp)
        patch_rms=float(tool.std())
        blocks.append({"number":i+1,"origin_px":[x,y],"size_px":[w,hp],
                       "size_metres":[wm,hm],"tool_rms_mm":patch_rms,
                       "base_std":float(b.astype(float).std(axis=(0,1)).mean())})
    save(canvas,"blocks.jpg")

    # Native-resolution close views, four columns per sampled spot.
    crop_imgs=[];crop_titles=[]
    for j,(x,y) in enumerate([(250,270),(1780,690),(690,1510)]):
        for a,name in ((base,"base"),(h,"height / 0-6 mm"),(arrays['normal'],"normal"),(lit,"relit")):
            a=wrapped_crop(a,x,y,420,420)
            if a.ndim==2: a=a/6*255
            crop_imgs.append(rgb(a));crop_titles.append(f"{j+1} / {name} / native pixels")
    sheet(crop_imgs,crop_titles,4,420,"detail.jpg")

    # Independently recompute exact normals from the saved uint16 height.
    dx=(np.roll(h,-1,1)-np.roll(h,1,1))/(2*3000/N)
    dy=(np.roll(h,-1,0)-np.roll(h,1,0))/(2*3000/N)
    expected=np.dstack((-dx,dy,np.ones_like(h)))
    expected/=np.linalg.norm(expected,axis=2)[...,None]
    angle=np.degrees(np.arccos(np.clip(np.sum(expected*normal,2),-1,1)))
    encoded=np.rint((expected*.5+.5)*255).astype(np.uint8)
    normal_mismatch=int(np.count_nonzero(encoded!=arrays['normal']))
    metadata={}
    for k in names:
        path=ROOT/f"dressed_{k}.png"
        raw=path.read_bytes()
        width,height,depth,colour=struct.unpack('>IIBB',raw[16:26])
        metadata[k]={"size":[width,height],"bit_depth":depth,"png_colour_type":colour,
                     "mode":ims[k].mode,"icc_profile":bool(ims[k].info.get('icc_profile')),
                     "sha256":hashlib.sha256(raw).hexdigest()}
        assert (width,height)==(N,N)
        assert depth==(16 if k=='height' else 8)
        assert colour==(0 if k=='height' else 2)
        assert bool(ims[k].info.get('icc_profile'))==(k=='base')

    mean=base.mean((0,1))
    # Colour-only revision: compare actual file bytes and every shared field.
    archive=ROOT/'round2'
    physical_unchanged={k:metadata[k]['sha256']==hashlib.sha256(
        (archive/f'dressed_{k}.png').read_bytes()).hexdigest()
        for k in ('height','normal','orm')}
    with np.load(archive/'derivation.npz') as old_fields:
        fields_unchanged=(set(fields.files)==set(old_fields.files) and
                          all(np.array_equal(fields[k],old_fields[k]) for k in fields.files))
    old_base=np.asarray(Image.open(archive/'dressed_base.png'),dtype=np.float64)
    colour_delta=base-old_base
    seams={k:seam_stats(a) for k,a in arrays.items()}
    # A wrap is one more adjacent sample, not an edge copied to its opposite.
    seam_pass=all(s['wrap_over_interior']<1.5 for m in seams.values() for s in m.values())
    slopes=np.sqrt(dx*dx+dy*dy)
    rough=orm[...,1]
    ao=orm[...,0]
    pits=fields['pits_mm']
    mask=pits>.20
    native=fields['native_detail_mm']
    down=Image.fromarray(native).resize((1024,1024),Image.Resampling.BOX).resize((N,N),Image.Resampling.BICUBIC)
    residual=native-np.asarray(down)
    # Coverage over EVERY possible 0.25-m square, not only the twelve examples.
    from scipy.ndimage import uniform_filter
    t=fields['tool_depth_mm']
    sample=round(.25/3*N)
    local_variance=uniform_filter(t*t,sample,mode='wrap')-uniform_filter(t,sample,mode='wrap')**2
    min_tool_rms=float(np.sqrt(np.maximum(local_variance,0)).min())
    # Resolve irregular patch area in physical units on a toroidal Voronoi map.
    manifest=json.loads((ROOT/'build_manifest.json').read_text())
    original_layout=json.loads((ROOT/'patch_layout.json').read_text())['patches']
    patch_layout_unchanged=manifest['patches']==original_layout
    old_manifest=json.loads((archive/'build_manifest.json').read_text())
    records_unchanged=all(manifest[k]==old_manifest[k] for k in ('patches','tooling','features','source_sha256'))
    centers=np.array([p['center_px'] for p in manifest['patches']])
    tree=cKDTree(centers,boxsize=N)
    gy,gx=np.mgrid[0:N:8,0:N:8]
    _,ids=tree.query(np.c_[gx.ravel(),gy.ravel()])
    areas=np.bincount(ids,minlength=len(centers))*64*(3/N)**2
    widths=np.sqrt(areas)
    lum=base[...,0]*.2126+base[...,1]*.7152+base[...,2]*.0722
    source_correlation=float(np.corrcoef(lum.ravel(),fields['mineral'].ravel())[0,1])
    pit_centers=[f['center_px'] for f in manifest['features'] if f['kind']=='pit']
    pit_depths=[float(pits[y,x]) for x,y in pit_centers]
    reconstructed_h=5.35-fields['tool_depth_mm']-pits+fields['geology_mm']
    derivation_error=float(np.max(np.abs(reconstructed_h-h)))
    xx=np.linspace(-.5,.5,N)
    trend_x=float(np.polyfit(xx,lum.mean(0),1)[0])
    trend_y=float(np.polyfit(xx,lum.mean(1),1)[0])
    metrics={"files":metadata,"target_srgb":TARGET.tolist(),"mean_srgb":mean.tolist(),
             "round2_physical_pngs_byte_identical":physical_unchanged,
             "round2_shared_fields_identical":fields_unchanged,
             "round2_patch_tool_feature_source_records_identical":records_unchanged,
             "colour_delta_from_round2":{"mean":colour_delta.mean((0,1)).tolist(),
                                        "spatial_std":colour_delta.std((0,1)).tolist()},
             "std_srgb":base.std((0,1)).tolist(),
             "patch_layout_unchanged":patch_layout_unchanged,
             "source_mineral_albedo_correlation":source_correlation,
             "pit_center_depth_mm_min_mean_max":[min(pit_depths),float(np.mean(pit_depths)),max(pit_depths)],
             "tool_cut_depth_mm_p50_p95_p99_max":np.percentile(t,[50,95,99,100]).tolist(),
             "saved_height_derivation_max_error_mm":derivation_error,
             "mean_colour_max_error":float(np.abs(mean-TARGET).max()),
             "linear_fit_colour_change_across_tile":{"x":trend_x,"y":trend_y},
             "height_mm":{"min":float(h.min()),"max":float(h.max()),"mean":float(h.mean()),"std":float(h.std())},
             "normal":{"reencoded_channel_mismatches":normal_mismatch,
                       "angle_mean_degrees":float(angle.mean()),"angle_p99_degrees":float(np.percentile(angle,99)),
                       "angle_max_degrees":float(angle.max()),
                       "decoded_length_min_max":[float(lengths.min()),float(lengths.max())],
                       "surface_tilt_p50_p95_p99_degrees":np.degrees(np.arctan(np.percentile(slopes,[50,95,99]))).tolist()},
             "orm":{"ao_min_mean_max":[float(ao.min()),float(ao.mean()),float(ao.max())],
                    "roughness_min_mean_max":[float(rough.min()),float(rough.mean()),float(rough.max())],
                    "nonzero_metalness_pixels":int(np.count_nonzero(orm[...,2])),
                    "pit_ao_mean":float(ao[mask].mean()),"nonpit_ao_mean":float(ao[~mask].mean())},
             "patch_area_square_root_metres_min_median_max":np.percentile(widths,[0,50,100]).tolist(),
             "minimum_tool_rms_in_any_025m_square_mm":min_tool_rms,
             "native_detail_rms_mm":float(native.std()),
             "native_detail_residual_after_1k_roundtrip_rms_mm":float(residual.std()),
             "seams":seams,"seams_pass":seam_pass,"blocks":blocks}
    # Inspect shared tiny features at readable magnification, with AO and
    # roughness unpacked. Their positions are never re-detected or shifted.
    aligned=[];aligned_titles=[]
    for kind in ('pit','inclusion','shell','iron'):
        feature=next(f for f in manifest['features'] if f['kind']==kind)
        x,y=feature['center_px']
        for a,label in ((base,'base'),(h,'height'),(arrays['normal'],'normal'),
                        (ao*255,'AO'),(rough*255,'roughness'),(lit,'relit')):
            a=wrapped_crop(a,x-40,y-40,80,80)
            if label=='height': a=a/6*255
            im=rgb(a).resize((320,320),Image.Resampling.NEAREST)
            aligned.append(im);aligned_titles.append(f'{kind} / {label}')
    sheet(aligned,aligned_titles,6,320,'alignment.jpg')
    # Each tool character under two opposing side lights at the true scale.
    tools_images=[];tools_titles=[]
    left=np.asarray(relit[0]);right=np.asarray(relit[1])
    for style in ('batted','clawed','punched'):
        patch=next(p for p in manifest['patches'] if p['style']==style)
        x,y=map(int,patch['center_px'])
        for a,label in ((base,'base'),(h/6*255,'height'),(left,'left light'),(right,'right light')):
            a=wrapped_crop(a,x-160,y-160,320,320)
            tools_images.append(rgb(a));tools_titles.append(f'{style} / {label}')
    sheet(tools_images,tools_titles,4,400,'tooling.jpg')
    # Same location and original display scale for an honest revision proof.
    previous=Image.open(archive/'checks/detail.jpg')
    compare=[previous.crop((0,38,420,458)),crop_imgs[0],
             previous.crop((1260,38,1680,458)),crop_imgs[3]]
    sheet(compare,['round 2 / base','cream / base','round 2 / relit','cream / relit'],
          2,420,'revision_comparison.jpg')
    (OUT/'metrics.json').write_text(json.dumps(metrics,indent=2,allow_nan=False)+'\n')
    assert np.abs(mean-TARGET).max()<=.01
    assert all(physical_unchanged.values())
    assert fields_unchanged and records_unchanged
    assert np.all(colour_delta.std((0,1))[[0,2]]>.5), 'Colour revision must include local mineral colour.'
    assert np.all((base.std((0,1))>=8)&(base.std((0,1))<=12))
    assert patch_layout_unchanged
    assert h.max()-h.min()>4.5
    assert min(pit_depths)>=1.99 and max(pit_depths)<=3.01
    assert derivation_error<.00005
    assert normal_mismatch==0
    assert angle.max()<.4
    assert np.count_nonzero(orm[...,2])==0
    assert rough.min()>=.69 and rough.max()<=.91
    assert ao.mean()>.98
    assert ao[mask].mean()<ao[~mask].mean()
    assert min_tool_rms>.025
    assert seam_pass,"Inspect seam metrics and repair before shipping"
    print(json.dumps({k:metrics[k] for k in ['mean_srgb','std_srgb','height_mm','normal','orm',
                     'round2_physical_pngs_byte_identical','round2_shared_fields_identical',
                     'round2_patch_tool_feature_source_records_identical','colour_delta_from_round2',
                     'patch_layout_unchanged','source_mineral_albedo_correlation',
                     'tool_cut_depth_mm_p50_p95_p99_max','pit_center_depth_mm_min_mean_max',
                     'patch_area_square_root_metres_min_median_max',
                     'minimum_tool_rms_in_any_025m_square_mm','seams_pass']},indent=2))
    print('PASS: round2 physical data identical; dimensions, PNG types, profiles, colour, exact normals, ORM, tooling coverage, seams.')


if __name__=='__main__':
    main()
