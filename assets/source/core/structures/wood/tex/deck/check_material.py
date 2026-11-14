"""Independent saved-file verification and review sheets. Run after build_material.py."""
from pathlib import Path
import json
import struct
import hashlib
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy.ndimage import label, gaussian_filter

ROOT=Path(__file__).resolve().parent
OUT=ROOT/'checks'
N=2048
PITCH=3000/N
RANGE=12.0
FONT_PATH='/System/Library/Fonts/Supplemental/Arial.ttf'
try:
    FONT=ImageFont.truetype(FONT_PATH,22)
    SMALL=ImageFont.truetype(FONT_PATH,16)
except OSError:
    FONT=SMALL=ImageFont.load_default()


def rgb(a):
    return Image.fromarray(np.uint8(np.clip(np.rint(a),0,255))).convert('RGB')


def panel(im, title, size=512):
    out=Image.new('RGB',(size,size+40),(24,26,28))
    out.paste(im.resize((size,size),Image.Resampling.LANCZOS),(0,40))
    ImageDraw.Draw(out).text((12,9),title,font=SMALL,fill=(232,231,226))
    return out


def sheet(panels, cols, filename):
    w,h=panels[0].size
    out=Image.new('RGB',(cols*w,((len(panels)+cols-1)//cols)*h),(24,26,28))
    for i,p in enumerate(panels): out.paste(p,((i%cols)*w,(i//cols)*h))
    out.save(OUT/filename,quality=94,subsampling=0)
    return out


def crop_wrap(a,cx,cy,w,h=None):
    if h is None: h=w
    ix=np.arange(int(cx-w//2),int(cx-w//2+w))%N
    iy=np.arange(int(cy-h//2),int(cy-h//2+h))%N
    return a[np.ix_(iy,ix)]


def srgb_linear(a):
    a=a/255.
    return np.where(a<=.04045,a/12.92,((a+.055)/1.055)**2.4)


def linear_srgb(a):
    a=np.maximum(a,0)
    return np.where(a<=.0031308,a*12.92,1.055*a**(1/2.4)-.055)*255


def distant_repeat(a):
    """4x4 / 12 m square at exactly 512 px, filtered in linear light.

    A wrapped 64-texel margin supplies the full Lanczos footprint at 16:1;
    crop it after filtering so the thumbnail itself repeats without a border.
    """
    linear=srgb_linear(a.astype(np.float32))
    channels=[]
    for c in range(3):
        padded=np.pad(linear[:,:,c],64,mode='wrap')
        small=np.array(Image.fromarray(padded).resize((136,136),Image.Resampling.LANCZOS))
        channels.append(small[4:132,4:132])
    return rgb(linear_srgb(np.tile(np.stack(channels,axis=-1),(4,4,1))))


def padded_small_panel(im,title):
    # Keep the requested 512 px square at native size inside the 640 px grid.
    out=Image.new('RGB',(640,680),(24,26,28))
    out.paste(im,(64,70))
    ImageDraw.Draw(out).text((12,9),title,font=SMALL,fill=(232,231,226))
    ImageDraw.Draw(out).text((64,609),'12 x 12 m / 4 x 4 tiles / 512 x 512 pixels',font=SMALL,fill='white')
    return out


def light(base,normal,orm,direction,clay=False,raking=False,height=None):
    """Orthographic directional diffuse + modest GGX, in linear light."""
    n=normal.astype(np.float32)/127.5-1
    n/=np.linalg.norm(n,axis=-1,keepdims=True)
    l=np.array(direction,np.float32); l/=np.linalg.norm(l)
    h=l+np.array([0,0,1]); h/=np.linalg.norm(h)
    nl=np.clip(np.sum(n*l,axis=2),0,1); nv=np.clip(n[:,:,2],.001,1)
    nh=np.clip(np.sum(n*h,axis=2),0,1); vh=float(h[2])
    colour=srgb_linear(base.astype(np.float32)) if not clay else np.full(base.shape,.32,np.float32)
    m=orm[:,:,2].astype(np.float32)/255 if not clay else np.zeros(base.shape[:2])
    rough=orm[:,:,1].astype(np.float32)/255 if not clay else np.full(base.shape[:2],.8)
    alpha=rough**2; a2=alpha**2
    D=a2/(np.pi*((nh*nh*(a2-1)+1)**2)+1e-6)
    k=(rough+1)**2/8
    G=(nv/(nv*(1-k)+k))*(nl/(nl*(1-k)+k))
    f0=.04*(1-m[:,:,None])+colour*m[:,:,None]
    F=f0+(1-f0)*(1-vh)**5
    spec=(D*G/(4*nv*nl+1e-5))[:,:,None]*F
    ambient=(.18 if raking else .30)*colour*(orm[:,:,0:1]/255.)
    visibility=np.ones(base.shape[:2],np.float32)
    if raking and height is not None:
        # Height-field shadows, only in review lighting. The 12 mm scale and
        # 3 m tile are identical to the saved normals; no bump-strength boost.
        horizontal=np.linalg.norm(l[:2])
        for step in range(1,49):
            ox=int(round(step*l[0]/horizontal)); oy=int(round(-step*l[1]/horizontal))
            towards=np.roll(height,(-oy,-ox),(0,1))
            clearance=height+step*PITCH*l[2]/horizontal-towards
            visibility=np.minimum(visibility,np.clip(.7+clearance/(.8+step*.055),0,1))
        visibility=.20+.80*visibility
    direct=(3.0 if raking else 1.2)*nl[:,:,None]*(colour*(1-m[:,:,None])+spec*.65)*visibility[:,:,None]
    return rgb(linear_srgb(ambient+direct))


def torus_components(binary):
    labels,count=label(binary)
    parent=np.arange(count+1)
    def root(k):
        while parent[k]!=k:
            parent[k]=parent[parent[k]]; k=parent[k]
        return k
    for a,b in [(labels[:,0],labels[:,-1]),(labels[0],labels[-1])]:
        for x,y in zip(a,b):
            if x and y: parent[root(int(x))]=root(int(y))
    return len({root(k) for k in range(1,count+1)})


def main():
    OUT.mkdir(exist_ok=True)
    arrays={}; ims={}; props={}
    for name in ['base','height','normal','orm']:
        p=ROOT/f'deck_{name}.png'
        im=Image.open(p); a=np.array(im)
        arrays[name]=a
        bitdepth,ctype=struct.unpack('BB',p.read_bytes()[24:26])
        props[name]={'size':list(im.size),'png_bit_depth':bitdepth,
                     'png_color_type':ctype,'icc':bool(im.info.get('icc_profile')),
                     'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
        assert im.size==(N,N)
        assert bitdepth==(16 if name=='height' else 8)
        assert ctype==(0 if name=='height' else 2)
        assert bool(im.info.get('icc_profile'))==(name=='base')
        ims[name]=rgb(a/257) if name=='height' else im.convert('RGB')
    base=arrays['base']; normal=arrays['normal']; orm=arrays['orm']
    height=arrays['height'].astype(np.float64)*RANGE/65535
    meta=json.loads((ROOT/'source'/'construction.json').read_text())
    masks=np.load(ROOT/'source'/'construction_masks.npz')
    # Recalculate independently from the saved 16-bit height, using physical units.
    dhx=(height[:,np.r_[1:N,0]]-height[:,np.r_[N-1,0:N-1]])/(2*PITCH)
    dhy=(height[np.r_[1:N,0],:]-height[np.r_[N-1,0:N-1],:])/(2*PITCH)
    expected=np.stack([-dhx,dhy,np.ones_like(height)],axis=2)
    expected/=np.linalg.norm(expected,axis=2,keepdims=True)
    quantized=np.rint((expected+1)*127.5).astype(np.uint8)
    assert np.array_equal(quantized,normal), 'Saved normal differs from saved-height derivatives'
    decoded=normal.astype(np.float64)/127.5-1
    lengths=np.linalg.norm(decoded,axis=2)
    decoded/=lengths[:,:,None]
    angle=np.degrees(np.arccos(np.clip(np.sum(decoded*expected,axis=2),-1,1)))
    yy=np.arange(N)+.5
    width=N/12
    expected_gap=np.clip(meta['gap_width_px']/2+.5-np.minimum(yy%width,width-yy%width),0,1)
    gap=masks['gap'].astype(float)
    assert np.max(np.abs(gap-expected_gap[:,None]))<.0003
    gap_widths=[]; measured_centres=[]
    for k in range(12):
        line=k*width
        rows=np.arange(int(np.floor(line))-5,int(np.floor(line))+6)
        weights=gap[rows%N].mean(axis=1)
        gap_widths.append(float(weights.sum()))
        measured_centres.append(float(np.sum((rows+.5)*weights)/weights.sum()))
    # Hairlines are subpixel coverage, so detect the local recess in saved height
    # relative to its flanks, avoiding the two rows of nails.
    detected=[]
    joint_dips=[]
    for k,b in enumerate(meta['boards']):
        js=b['joints_x']
        assert len(js) in [0,1,2]
        assert all(x in [0,512,1024,1536] for x in js)
        for separation in [1,2,3]:
            assert not set(js)&set(meta['boards'][(k+separation)%12]['joints_x'])
        rows=np.arange(int(k*width+width*.38),int(k*width+width*.62))
        found=[]
        for j in [0,512,1024,1536]:
            v=height[np.ix_(rows,[(j-1)%N,j])].mean()
            flank=height[np.ix_(rows,[(j-5)%N,(j-4)%N,(j+3)%N,(j+4)%N])].mean()
            dip=float(flank-v)
            joint_dips.append({'board':k,'joist_x':j,'recess_mm':dip,'joint':j in js})
            if dip>1.25: found.append(j)
        assert found==js, (k,found,js)
        detected.append(found)
    nails=meta['nails']
    line_counts={str(x):sum(x in js for js in detected) for x in [0,512,1024,1536]}
    assert max(line_counts.values())<=3
    assert sum(len(js)==2 for js in detected)<=4
    assert sum(len(js)<=1 for js in detected)>6
    expected_nails=12*4*2+2*sum(map(len,detected))
    assert len(nails)==expected_nails
    assert set(np.unique(orm[:,:,2]))=={0,255}
    coverage=masks['nails'].astype(float)
    mismatches=int(np.count_nonzero((orm[:,:,2]>0)!=(coverage>=.5)))
    assert mismatches==0
    component_count=torus_components(orm[:,:,2]>0)
    assert component_count==expected_nails, component_count
    inset_errors=[]
    for nail in nails:
        k=nail['board']; j=nail['joist_x']
        cy=nail['y']; cx=nail['x']
        inset=min(cy-k*width,(k+1)*width-cy)*PITCH
        inset_errors.append(abs(inset-50))
        xdist=abs((cx-j+N/2)%N-N/2)
        assert abs(xdist-(12 if nail['at_joint'] else 0))<1e-6
        assert orm[int(cy)%N,int(cx)%N,2]==255
    for k,js in enumerate(detected):
        for j in [0,512,1024,1536]:
            group=[n for n in nails if n['board']==k and n['joist_x']==j]
            expected_x={(j-12)%N,(j+12)%N} if j in js else {j}
            assert {(n['x'],n['side_edge']) for n in group}=={(x,e) for x in expected_x for e in [0,1]}
            assert all(n['at_joint']==(j in js) for n in group)
    seams={}
    for name,a0 in arrays.items():
        a=a0.astype(np.float64)/(257 if name=='height' else 1)
        if a.ndim==2: a=a[:,:,None]
        xedge=np.abs(a[:,-1]-a[:,0]).mean()
        yedge=np.abs(a[-1]-a[0]).mean()
        cols=np.abs(np.diff(a,axis=1)).mean(axis=(0,2))
        xjoists=[float(np.abs(a[:,j-1]-a[:,j]).mean()) for j in [512,1024,1536]]
        # For each joist compare only uninterrupted wood, omitting actual joints,
        # nails and the lateral gaps. A real joint has opposite-facing normals
        # on its two lips and must not be tested as though it were a flat face.
        face_errors=[]
        joint_errors=[]
        for xj in [0,512,1024,1536]:
            continuous=[]; ends=[]
            for k,b in enumerate(meta['boards']):
                rows=np.arange(int(k*width+52),int((k+1)*width-52))
                delta=np.abs(a[rows,(xj-1)%N]-a[rows,xj])
                (ends if xj in b['joints_x'] else continuous).append(delta.ravel())
            face_errors.append(float(np.concatenate(continuous).mean()))
            joint_errors.append(float(np.concatenate(ends).mean()))
        # Vertical edge is in a designed gap; compare to the same centered gap
        # samples at the three interior, integer-aligned board lines.
        same_phase=[512,1024,1536]
        ygaps=[float(np.abs(a[j-1]-a[j]).mean()) for j in same_phase]
        seams[name]={'x_wrap_mean_255':float(xedge),
                     'x_interior_p95_255':float(np.percentile(cols,95)),
                     'x_other_joist_lines_255':xjoists,
                     'x_continuous_face_0_512_1024_1536_255':face_errors,
                     'x_joint_lips_0_512_1024_1536_255':joint_errors,
                     'y_wrap_mean_255':float(yedge),
                     'y_comparable_gap_mean_255':float(np.mean(ygaps)),
                     'y_comparable_gaps_255':ygaps}
    wood=(gap<.01)&(masks['joint']<.01)&(coverage<.01)&(masks['checks']<.01)&(masks['iron_stain']<.05)
    board_means=[]
    for k in range(12):
        sel=wood&((np.arange(N)[:,None]+.5)//width==k)
        board_means.append(base[sel].mean(axis=0).tolist())
    grain_relief=[]
    for k in range(12):
        sel=wood&((np.arange(N)[:,None]+.5)//width==k)
        # Exclude the rounded outer 12 px and actual checks from face statistics.
        dy=np.minimum(yy%width,width-yy%width)
        sel&=dy[:,None]>12
        grain_relief.append(float(np.percentile(height[sel],95)-np.percentile(height[sel],5)))
    # Pass-two measurements isolate the component being evaluated. Total face
    # height percentiles also include cupping, so cannot be called grain depth.
    late=masks['latewood'].astype(float)
    local_profile=height+masks['cup_mm'].astype(float)+masks['edge_mm'].astype(float)
    interior=wood&(np.minimum(yy%width,width-yy%width)[:,None]>16)
    ridge_deltas=[]
    for k in range(12):
        sel=interior&((yy[:,None]//width)==k)
        ridge_deltas.append(float(np.median(local_profile[sel&(late>.85)])-
                                  np.median(local_profile[sel&(late<.15)])))
    assert min(ridge_deltas)>.5 and max(ridge_deltas)<1.2, ridge_deltas
    assert all(1<=b['cup_depth_mm']<=2 and 10<=b['edge_roll_width_mm']<=15
               and 2<=b['edge_roll_drop_mm']<=4 for b in meta['boards'])
    full_heads=coverage>.99
    iron_range=[int(base[full_heads].min()),int(base[full_heads].max())]
    assert 60<=iron_range[0]<=iron_range[1]<=80, iron_range
    metal_range=[int(base[orm[:,:,2]>0].min()),int(base[orm[:,:,2]>0].max())]
    assert 60<=metal_range[0]<=metal_range[1]<=80, metal_range
    old_meta=json.loads((OUT/'pass2'/'construction.json').read_text())
    old_masks=np.load(OUT/'pass2'/'construction_masks.npz')
    previous={n:np.array(Image.open(OUT/'pass2'/f'deck_{n}.png')) for n in ['base','height','normal','orm']}
    # Pass 5 is strictly a palette change. Verify against frozen pre-edit files,
    # independently of the build's current constants and construction code.
    pass4=OUT/'pass4'
    archive=json.loads((pass4/'archive.json').read_text())['sha256']
    prior={n:np.array(Image.open(pass4/f'deck_{n}.png')) for n in arrays}
    prior_meta=json.loads((pass4/'construction.json').read_text())
    prior_masks=np.load(pass4/'construction_masks.npz')
    for name in arrays:
        path=pass4/f'deck_{name}.png'
        assert hashlib.sha256(path.read_bytes()).hexdigest()==archive[path.name]
    unchanged_files=['deck_height.png','deck_normal.png','deck_orm.png',
                     'source/construction_masks.npz','source/srgb.icc']
    unchanged_files += [name for name in archive if name.startswith('source/atlas_')]
    for name in unchanged_files:
        assert hashlib.sha256((ROOT/name).read_bytes()).hexdigest()==archive[name], name
    assert set(masks.files)==set(prior_masks.files)
    for name in masks.files:
        assert np.array_equal(masks[name],prior_masks[name]), name
    palette_keys={'revision','target_mean_srgb','build_seconds','palette',
                  'palette_method','blue_toe_srgb','blue_toe_pixels'}
    for key,value in prior_meta.items():
        if key not in palette_keys:
            assert meta[key]==value, key
    assert meta['revision']==5 and meta['target_mean_srgb']==[167,138,101]
    mean=base.mean(axis=(0,1))
    assert np.max(np.abs(mean-[167,138,101]))<.002, mean
    assert base.min()>0 and base.max()<255, 'Palette clips local pigment detail'
    # Reconstruct the colour-only change from the archived, quantized PNG.
    # Undo pass 4's tiny blue toe (no longer needed at D). Independently check
    # that local pigment detail survives, including water and scuff regions.
    weight=(1-gap)*(1-masks['joint'].astype(float))*(1-coverage)*(orm[:,:,2]==0)
    expected_colour=prior['base'].astype(float)
    blue=expected_colour[:,:,2]
    toe=blue<12
    blue[toe]=12+12*np.log(blue[toe]/12)
    # Use the frozen build's authored board colours, not the current constants.
    import runpy
    old_targets=runpy.run_path(str(pass4/'build_material.py'))['TARGETS'].astype(float)
    for k,b in enumerate(prior_meta['boards']):
        rows=np.flatnonzero(yy//width==k)
        board_shift=.5*(old_targets.mean(axis=0)-old_targets[k])
        tint=np.broadcast_to(board_shift,(len(rows),N,3)).copy()
        tint+=.18*masks['polish'][rows,:,None].astype(float)*np.array([5,-10,-19])
        for j in b['joints_x']:
            dist=np.abs((np.arange(N)+.5-j+N/2)%N-N/2)
            tint+=.20*np.exp(-dist[None,:,None]/2.5)*np.array([19,11,6])
        expected_colour[rows]+=weight[rows,:,None]*tint
    translation=(np.array([167,138,101])-expected_colour.mean(axis=(0,1)))/weight.mean()
    expected_colour+=weight[:,:,None]*translation
    residual=base.astype(float)-expected_colour
    residual_max=float(np.abs(residual).max())
    regular_residual_max=float(np.abs(residual[~toe]).max())
    assert regular_residual_max<1.05, regular_residual_max
    assert residual_max<2.5, residual_max  # Inverting a rounded low blue amplifies its error.
    assert np.array_equal(base[orm[:,:,2]>0],prior['base'][orm[:,:,2]>0])
    assert np.array_equal(base[gap==1],prior['base'][gap==1])
    prior_board_means=[]
    for k in range(12):
        sel=wood&((yy[:,None]//width)==k)
        prior_board_means.append(prior['base'][sel].mean(axis=0).tolist())
    before_board_std=np.std(prior_board_means,axis=0)
    after_board_std=np.std(board_means,axis=0)
    variety_ratio=after_board_std/before_board_std
    assert np.all((variety_ratio>.4)&(variety_ratio<.6)), variety_ratio
    board_order_correlation=[float(np.corrcoef(np.array(prior_board_means)[:,c],
                                              np.array(board_means)[:,c])[0,1]) for c in range(3)]
    assert min(board_order_correlation)>.98, board_order_correlation
    raised=interior&(late>.85)
    low=interior&(late<.15)
    raised_colour=base[raised].mean(axis=0)
    low_colour=base[low].mean(axis=0)
    assert np.all(raised_colour>low_colour), (raised_colour,low_colour)
    # Compare the written unlit D and B swatches, not warm-lit painting samples.
    wall=np.array([172,128,82],float)
    luminance=np.array([.2126,.7152,.0722])
    floor_luminance=float(srgb_linear(mean)@luminance)
    wall_luminance=float(srgb_linear(wall)@luminance)
    floor_saturation=float((mean.max()-mean.min())/mean.max())
    wall_saturation=float((wall.max()-wall.min())/wall.max())
    assert floor_luminance>wall_luminance and floor_saturation<wall_saturation
    palette={'before_mean_srgb':prior['base'].mean(axis=(0,1)).tolist(),
             'target_mean_srgb':[167,138,101], 'after_mean_srgb':mean.tolist(),
             'unchanged_files_sha256':{name:archive[name] for name in unchanged_files},
             'all_construction_masks_exactly_preserved':masks.files,
             'all_layout_metadata_exactly_preserved':True,
             'iron_pixels_and_full_gap_pixels_exactly_preserved':True,
             'wood_translation_srgb':translation.tolist(),
             'palette_transform_residual_max_code_value':residual_max,
             'palette_transform_residual_max_outside_prior_toe':regular_residual_max,
             'board_mean_std_before_srgb':before_board_std.tolist(),
             'board_mean_std_after_srgb':after_board_std.tolist(),
             'board_mean_std_ratio':variety_ratio.tolist(),
             'board_order_correlation':board_order_correlation,
             'palette_srgb':meta['palette_srgb'],
             'before_board_mean_srgb':prior_board_means,
             'raised_fibre_mean_srgb':raised_colour.tolist(),
             'low_fibre_mean_srgb':low_colour.tolist(),
             'water_area_residual_max':float(np.abs(residual[masks['water']>.2]).max()),
             'scuff_area_residual_max':float(np.abs(residual[masks['scuff']>.2]).max()),
             'base_channel_min':base.min(axis=(0,1)).tolist(),
             'base_channel_max':base.max(axis=(0,1)).tolist(),
             'linear_luminance_floor_wall':[floor_luminance,wall_luminance],
             'hsv_saturation_floor_wall':[floor_saturation,wall_saturation]}
    for old,new in zip(old_meta['boards'],meta['boards']):
        for key in ['board','y0','y1','source_crops','segments','cup_depth_mm','edge_roll_width_mm','edge_roll_drop_mm']:
            assert old[key]==new[key], (key,new['board'])
    preserved_masks=['gap','polish','cup_mm','edge_mm','chips','water','scuff']
    for key in preserved_masks:
        assert np.array_equal(old_masks[key],masks[key]), key
    # Beyond the old end-treatment neighbourhoods, the physical surface is exact.
    untouched=np.ones((N,N),bool)
    for k,b in enumerate(old_meta['boards']):
        rows=np.flatnonzero((yy//width)==k)
        for x in b['joints_x']:
            cols=np.flatnonzero(np.abs((np.arange(N)+.5-x+N/2)%N-N/2)<160)
            untouched[np.ix_(rows,cols)]=False
    height_unchanged=np.array_equal(previous['height'][untouched],arrays['height'][untouched])
    assert height_unchanged, 'Unrelated face relief changed'
    ordinary_preserved=0
    for old in old_meta['nails']:
        if old['at_joint']: continue
        new=next(n for n in nails if n['board']==old['board'] and n['joist_x']==old['joist_x'] and n['side_edge']==old['side_edge'])
        for key in ['x','y','angle_radians','head_size_px']:
            assert old[key]==new[key]
        old_cut=crop_wrap(previous['orm'][:,:,2],old['x'],old['y'],16)
        new_cut=crop_wrap(orm[:,:,2],new['x'],new['y'],16)
        assert np.array_equal(old_cut,new_cut)
        ordinary_preserved+=1
    # Quantify the requested quiet joints using the saved albedo, not masks alone.
    joint_face=(masks['joint']>0)&(gap<.01)&(coverage<.01)&(masks['iron_stain']<.05)
    joint_luma=float(base[joint_face].mean())
    gap_luma=float(base[gap>.99].mean())
    assert joint_luma>=gap_luma
    head_levels={kind:[] for kind in ['joint','ordinary']}
    head_contrasts={kind:[] for kind in head_levels}
    for n in nails:
        cut=crop_wrap(base,n['x'],n['y'],48)
        mc=crop_wrap(orm[:,:,2],n['x'],n['y'],48)>0
        cy,cx=np.mgrid[-24:24,-24:24]
        head=(np.abs(cx)<6)&(np.abs(cy)<6)&mc
        surround=(np.abs(cy)>=12)&(np.abs(cy)<20)&(np.abs(cx)<8)
        kind='joint' if n['at_joint'] else 'ordinary'
        head_levels[kind].append(float(cut[head].mean()))
        head_contrasts[kind].append(float(cut[surround].mean()-cut[head].mean()))
    assert abs(np.mean(head_levels['joint'])-np.mean(head_levels['ordinary']))<2
    assert np.mean(head_contrasts['joint'])<=np.mean(head_contrasts['ordinary'])+3
    # Evaluate all 19 former joint sites; disappearing sites must count too.
    distant_contrasts={}
    for caption,a in [('pass2',previous['base']),('pass4',prior['base']),('pass5',base)]:
        small=np.array(distant_repeat(a))[:128,:128].mean(axis=2)
        values=[]
        for k,b in enumerate(old_meta['boards']):
            rows=np.arange(int((k+.35)*128/12),int((k+.65)*128/12))
            for j in b['joints_x']:
                center=j//16
                seam=small[np.ix_(rows,[(center-1)%128,center])].mean()
                flank=small[np.ix_(rows,[(center-3)%128,(center-2)%128,(center+1)%128,(center+2)%128])].mean()
                values.append(float(flank-seam))
        distant_contrasts[caption]=float(np.mean(values))
    assert distant_contrasts['pass4']<distant_contrasts['pass2']*.6
    assert distant_contrasts['pass5']<distant_contrasts['pass2']*.6
    assert distant_contrasts['pass5']<distant_contrasts['pass4']+.2
    # Saved-map evidence that raised fibres are more polished than earlywood.
    ridge_rough=float(np.mean(orm[:,:,1][interior&(late>.85)])/255)
    valley_rough=float(np.mean(orm[:,:,1][interior&(late<.15)])/255)
    assert ridge_rough<valley_rough-.06
    stats={'files':props,'tile_metres':3,'height_full_range_mm':[0,12],
           'palette_pass5':palette,
           'height_observed_mm':[float(height.min()),float(height.max())],
           'mean_srgb':base.mean(axis=(0,1)).tolist(),
           'normal_recomputed_code_max_error':int(np.abs(normal.astype(int)-quantized.astype(int)).max()),
           'normal_angle_degrees':{'mean':float(angle.mean()),'p99':float(np.percentile(angle,99)),
                                   'max':float(angle.max())},
           'normal_decoded_length_range':[float(lengths.min()),float(lengths.max())],
           'board_count':12,'gap_widths_px':gap_widths,'gap_centres_measured_px':measured_centres,
           'joint_count':sum(map(len,detected)),'detected_joints':detected,'nail_count':len(nails),
           'joint_line_use_counts':line_counts,'joint_spacing_checked_rows':[1,2,3],
           'joint_local_height_recesses':joint_dips,
           'joint_width_px':meta['joint_width_px'],'joint_width_mm':meta['joint_width_px']*PITCH,
           'joint_face_mean_srgb':joint_luma,'long_gap_mean_srgb':gap_luma,
           'head_mean_srgb':{k:float(np.mean(v)) for k,v in head_levels.items()},
           'head_mean_contrast_srgb':{k:float(np.mean(v)) for k,v in head_contrasts.items()},
           'distant_former_joint_contrast_srgb':distant_contrasts,
           'nail_toroidal_components':component_count,'nail_metal_mask_mismatches':mismatches,
           'nail_inset_max_error_mm':max(inset_errors),'seams':seams,
           'board_mean_srgb':board_means,'face_grain_p95_p05_mm':grain_relief,
           'face_grain_p95_p05_includes_cupping':True,
           'latewood_above_earlywood_mm':ridge_deltas,
           'cup_depths_mm':[b['cup_depth_mm'] for b in meta['boards']],
           'edge_roll_widths_mm':[b['edge_roll_width_mm'] for b in meta['boards']],
           'edge_roll_drops_mm':[b['edge_roll_drop_mm'] for b in meta['boards']],
           'full_nail_head_srgb_range':iron_range,
           'all_metal_pixel_srgb_range':metal_range,
           'ridge_roughness_mean':ridge_rough,'valley_roughness_mean':valley_rough,
           'source_crops_and_board_dimensions_unchanged_from_pass2':True,
           'pass2_masks_exactly_preserved':preserved_masks,
           'height_outside_end_neighbourhoods_exactly_preserved':height_unchanged,
           'preserved_height_pixel_fraction':float(untouched.mean()),
           'ordinary_nails_preserved':ordinary_preserved,
           'gap_bottom_height_p05_p95_mm':np.percentile(height[gap>.99],[5,95]).tolist(),
           'gap_bottom_srgb_p05_p95':np.percentile(base[gap>.99].mean(axis=1),[5,95]).tolist(),
           'split_depth_component_p50_p95_mm':np.percentile(masks['split_mm'][masks['checks']>.7],[50,95]).astype(float).tolist(),
           'hammer_dent_count':sum(n['legacy_style_index']%7==2 for n in nails),
           'wood_roughness_percentiles':(np.percentile(orm[:,:,1][wood],[1,50,99])/255).tolist(),
           'polished_wood_roughness_mean':float(orm[:,:,1][wood&(masks['polish']>.6)].mean()/255),
           'weathered_wood_roughness_mean':float(orm[:,:,1][wood&(masks['polish']<.1)].mean()/255),
           'wood_ao_percentiles':(np.percentile(orm[:,:,0][wood],[1,50,99])/255).tolist()}
    (OUT/'metrics.json').write_text(json.dumps(stats,indent=2)+'\n')
    # All four maps side-by-side plus isolated scalar channels and physical relief.
    layer_panels=[panel(ims[n],t) for n,t in [('base','BASE / sRGB'),('height','HEIGHT / 0-12 mm'),
                   ('normal','NORMAL / OpenGL'),('orm','ORM / linear RGB')]]
    layer_panels += [panel(rgb(orm[:,:,i]),t) for i,t in enumerate(['AO','ROUGHNESS','METALNESS'])]
    layer_panels += [panel(rgb(masks['polish']*255),'WALKED AREAS / diagnostic mask')]
    layer_sheet=sheet(layer_panels,4,'layers.jpg')
    offsets=[]
    for n in ['base','height','normal','orm']:
        a=arrays[n]
        shifted=np.roll(a,(N//2,N//2),(0,1))
        oi=rgb(shifted/257 if n=='height' else shifted)
        oi.save(OUT/f'deck_{n}_half_offset.png')
        offsets.append(panel(oi,n.upper()+' / half-tile offset'))
    offset_sheet=sheet(offsets,4,'offsets.jpg')
    # 3x3 at native size for close review, and at two distant display scales.
    repeat=np.tile(base,(3,3,1))
    rgb(repeat).save(OUT/'deck_base_3x3_native.jpg',quality=92,subsampling=0)
    rep=rgb(repeat).resize((1536,1536),Image.Resampling.LANCZOS)
    tilings=Image.new('RGB',(1536,1870),(24,26,28))
    tilings.paste(rep,(0,40))
    d=ImageDraw.Draw(tilings)
    d.text((16,9),'3 x 3 repeats / 9 x 9 metres / 512 px per tile',font=FONT,fill='white')
    small=rgb(repeat).resize((192,192),Image.Resampling.LANCZOS)
    tiny=rgb(repeat).resize((96,96),Image.Resampling.LANCZOS)
    tilings.paste(small,(24,1632)); tilings.paste(tiny,(260,1632))
    d.text((24,1596),'64 px per 3 m tile',font=SMALL,fill='white')
    d.text((260,1596),'32 px per tile',font=SMALL,fill='white')
    for i,(cx,cy,title) in enumerate([(0,0,'Native wrap crossing'),(1024,512,'Native joint / bevel')]):
        cut=rgb(crop_wrap(base,cx,cy,512,232))
        tilings.paste(cut,(472+i*520,1628))
        d.text((472+i*520,1596),title,font=SMALL,fill='white')
    tilings.save(OUT/'tilings.jpg',quality=95,subsampling=0)
    # Native 512 px detail of three boards including a butt joint and its heads.
    details=[]
    for n in ['base','height','normal','orm']:
        cut=crop_wrap(arrays[n],512,215,512)
        details.append(panel(rgb(cut/257 if n=='height' else cut),n.upper()+' / 1 texel = 1 pixel'))
    details_sheet=sheet(details,4,'native_details.jpg')
    nail_panels=[]
    for n in ['base','height','normal','orm']:
        # Board 1 joint x=512, y=204.8; both sides and both maps remain aligned.
        cut=crop_wrap(arrays[n],512,204.8,96)
        nail_panels.append(panel(rgb(cut/257 if n=='height' else cut).resize((480,480),Image.Resampling.NEAREST),
                                 n.upper()+' / joint nail pair, 5x',480))
    nail_sheet=sheet(nail_panels,4,'nail_alignment.jpg')
    lighting=[]
    directions=[('north-west',(-.45,.65,.62)),('south-east',(.45,-.65,.62)),
                ('raking-north',(.14,.964,.225)),('raking-south',(-.14,-.964,.225))]
    for clay in [False,True]:
        for label_,direction in directions:
            li=light(base,normal,orm,direction,clay,'raking' in label_,height)
            li.save(OUT/f'lit_{"clay" if clay else "material"}_{label_}.jpg',quality=95,subsampling=0)
            lighting.append(panel(li,('CLAY' if clay else 'MATERIAL')+' / '+label_,1024))
    lit_sheet=sheet(lighting,2,'relighting.jpg')
    relit_details=[]
    for clay in [False,True]:
        for label_ in ['north-west','south-east']:
            image_=np.array(Image.open(OUT/f'lit_{"clay" if clay else "material"}_{label_}.jpg'))
            relit_details.append(panel(rgb(crop_wrap(image_,512,215,640)),
                                ('CLAY' if clay else 'MATERIAL')+' / '+label_+' / native',640))
    sheet(relit_details,2,'relit_details.jpg')
    rake_details=[]
    for clay in [False,True]:
        for label_ in ['raking-north','raking-south']:
            a=np.array(Image.open(OUT/f'lit_{"clay" if clay else "material"}_{label_}.jpg'))
            cut=rgb(crop_wrap(a,512,215,640))
            cut.save(OUT/f'native_{"clay" if clay else "material"}_{label_}.png')
            rake_details.append(panel(cut,('CLAY' if clay else 'MATERIAL')+' / '+label_+' / 1:1',640))
    sheet(rake_details,2,'raking_details.jpg')
    rgb(crop_wrap(base,512,215,640)).save(OUT/'native_base.png')
    # Exactly the same light and exposure on the archived fourth pass.
    before_height=prior['height'].astype(float)*RANGE/65535
    comparison=[]
    for clay in [False,True]:
        before=light(prior['base'],prior['normal'],prior['orm'],directions[2][1],clay,True,before_height)
        after=Image.open(OUT/f'lit_{"clay" if clay else "material"}_raking-north.jpg')
        for caption,img in [('PASS 4',before),('PASS 5',after)]:
            comparison.append(panel(rgb(crop_wrap(np.array(img),512,215,640)),
                                    caption+' / '+('CLAY' if clay else 'MATERIAL')+' / same raking light',640))
    sheet(comparison,2,'pass_comparison.jpg')
    before_small=distant_repeat(prior['base'])
    after_small=distant_repeat(base)
    before_small.save(OUT/'repeat_4x4_pass4.png')
    after_small.save(OUT/'repeat_4x4_pass5.png')
    distant_panels=[panel(before_small,'PASS 4 / 12 m square / 512 px'),
                    panel(after_small,'PASS 5 / 12 m square / 512 px')]
    # Also compare the mip-scale material under the same moderate light.
    for caption,b,n,o in [('PASS 4',prior['base'],prior['normal'],prior['orm']),
                          ('PASS 5',base,normal,orm)]:
        lit=light(b,n,o,directions[0][1])
        distant_panels.append(panel(distant_repeat(np.array(lit)),caption+' / identical north-west light'))
    sheet(distant_panels,2,'distance_comparison.jpg')
    # Base-only comparisons at identical scale and coordinates; no preview light.
    palette_panels=[]
    for caption,a in [('BEFORE / PASS 4',prior['base']),('AFTER / PASS 5',base)]:
        palette_panels.append(panel(rgb(a),caption+' / BASE COLOUR',640))
    for caption,a in [('BEFORE / PASS 4',prior['base']),('AFTER / PASS 5',base)]:
        palette_panels.append(panel(rgb(crop_wrap(a,512,215,640)),caption+' / NATIVE BASE',640))
    sheet(palette_panels,2,'base_colour_comparison.jpg')
    # Geometry overlay preserves exact registration and shows all twelve bands.
    overlay=ims['base'].copy(); d=ImageDraw.Draw(overlay)
    for j in [0,512,1024,1536]: d.line((j,0,j,N),fill=(40,178,202),width=1)
    for k,b in enumerate(meta['boards']):
        y=k*width
        d.line((0,y,N,y),fill=(238,196,80),width=1)
        d.text((10,y+65),str(k),font=FONT,fill=(255,232,190))
        for j in b['joints_x']: d.line((j,y+4,j,y+width-4),fill=(243,119,79),width=3)
    for nail in nails:
        x,y=nail['x'],nail['y']
        d.rectangle((x-6,y-6,x+6,y+6),outline=(88,239,194),width=1)
    overlay.save(OUT/'layout_overlay.png')
    # Main review contact sheet: full layers, tiling, offsets, detail and two lights.
    contact=sheet([palette_panels[0],palette_panels[1],
                   panel(rgb(crop_wrap(base,512,215,640)),'PASS 5 / NATIVE UNLIT DECK D',640),
                   panel(ims['base'],'DECK / 3 m / 12 x 250 mm',640),
                   panel(rgb(repeat),'3 x 3 REPEAT',640),
                   panel(Image.open(OUT/'deck_base_half_offset.png'),'HALF OFFSET',640),
                   panel(rgb(crop_wrap(base,512,215,640)),'NATIVE DETAIL',640),
                   panel(Image.open(OUT/'lit_material_north-west.jpg'),'LIGHT / NORTH-WEST',640),
                   panel(Image.open(OUT/'lit_material_south-east.jpg'),'LIGHT / SOUTH-EAST',640),
                   panel(ims['height'],'HEIGHT / 0-12 mm',640),
                   panel(ims['normal'],'NORMAL / OpenGL',640),
                   panel(ims['orm'],'ORM / AO, roughness, metal',640),
                   panel(Image.open(OUT/'lit_material_raking-north.jpg'),'RAKING / 13 degrees',640),
                   panel(Image.open(OUT/'native_material_raking-north.png'),'RAKING / NATIVE 1:1',640),
                   panel(Image.open(OUT/'native_clay_raking-south.png'),'CLAY / OPPOSITE RAKE / 1:1',640),
                   padded_small_panel(before_small,'BEFORE / PASS 4 / 4 x 4'),
                   padded_small_panel(after_small,'AFTER / PASS 5 / 4 x 4'),
                   panel(overlay,'JOISTS, JOINTS AND NAIL POSITIONS',640)],3,'contact_sheet.jpg')
    print(json.dumps({k:stats[k] for k in ['mean_srgb','normal_angle_degrees','board_count','joint_count',
                  'nail_count','nail_toroidal_components','nail_metal_mask_mismatches',
                  'height_observed_mm','seams']},indent=2))
    print(json.dumps({'palette_pass5':palette},indent=2))
    print('PASS: unlit D palette, pass-4 height/normal/ORM bytes, layout and all masks unchanged, quieter board variation, preserved local pigment, formats, sparse wrapped joint spacing, quiet distant lines, nails, saved-height normals, iron colour and ridge polish.')


if __name__=='__main__': main()
