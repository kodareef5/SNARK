"""Numerical verification and visual evidence for boards_*.png.

Normals are independently recomputed from the delivered PNG. Relighting is a
simple linear-light diffuse/rough specular diagnostic, not an engine render.
"""
from pathlib import Path
import json
import struct
import hashlib
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy.ndimage import label, gaussian_filter

ROOT = Path(__file__).resolve().parent
OUT = ROOT/'checks'
N = 2048
PITCH = N/12
SCALE = 3000/N
RANGE = 12.0
# Independent pass 7 layout expectations, in delivered pixel coordinates.
ROLL_X = 512
ROLL_Y = 85

def rolled(array):
    if array.ndim==1: return np.roll(array,ROLL_Y,axis=0)
    return np.roll(array,(ROLL_Y,ROLL_X),axis=(0,1))

def archived(pass_name,key):
    return rolled(np.asarray(Image.open(OUT/pass_name/f'boards_{key}.png'),float))

def board_rows(k,inset=0):
    return (np.arange(int(k*PITCH+inset),int((k+1)*PITCH-inset))+ROLL_Y)%N

def columns(start,stop):
    return (np.arange(start,stop)+ROLL_X)%N

def detail_crop(im,box):
    """Follow an existing feature crop through the roll, including wrapped ends."""
    x0,y0,x1,y1=box
    xx=(np.arange(x0,x1)+ROLL_X)%N
    yy=(np.arange(y0,y1)+ROLL_Y)%N
    return Image.fromarray(np.asarray(im)[np.ix_(yy,xx)])

def rgb(a):
    a=np.asarray(a)
    if a.ndim==2: a=np.repeat(a[...,None],3,axis=2)
    return Image.fromarray(np.rint(np.clip(a,0,255)).astype(np.uint8))

def font(size=20):
    for f in ['/System/Library/Fonts/Supplemental/Arial.ttf','/System/Library/Fonts/Helvetica.ttc']:
        if Path(f).exists(): return ImageFont.truetype(f,size)
    return ImageFont.load_default()

def sheet(name,panels,cols=2,size=640):
    h=(len(panels)+cols-1)//cols
    result=Image.new('RGB',(cols*size,h*(size+40)),(24,23,22))
    d=ImageDraw.Draw(result)
    for i,(title,im) in enumerate(panels):
        x=(i%cols)*size;y=(i//cols)*(size+40)
        d.text((x+12,y+10),title,font=font(17),fill=(233,227,215))
        result.paste(im.convert('RGB').resize((size,size),Image.Resampling.LANCZOS),(x,y+40))
    result.save(OUT/name,quality=94)
    return result

def linear(a):
    a=a/255
    return np.where(a<=.04045,a/12.92,((a+.055)/1.055)**2.4)

def srgb(a):
    a=np.maximum(a,0)
    return np.clip(np.where(a<=.0031308,12.92*a,1.055*a**(1/2.4)-.055)*255,0,255)

def mean_ls(pixels):
    """Mean per-pixel HLS L/S in encoded sRGB, not HLS of the mean RGB."""
    a=pixels/255
    high=a.max(axis=-1);low=a.min(axis=-1)
    lightness=(high+low)/2
    saturation=np.divide(high-low,1-np.abs(2*lightness-1),
                         out=np.zeros_like(lightness),where=high>low)
    return [float(lightness.mean()),float(saturation.mean())]

def relight(base, normal, orm, light, ambient=.22, strength=1.0, clay=False):
    """View-normal diagnostic, including a rough environment response on iron."""
    if base.shape[0]>256:
        result=Image.new('RGB',(base.shape[1],base.shape[0]))
        for y in range(0,base.shape[0],128):
            result.paste(relight(base[y:y+128],normal[y:y+128],orm[y:y+128],
                                 light,ambient,strength,clay),(0,y))
        return result
    diffuse=linear(base)
    if clay: diffuse=np.full_like(diffuse,.34)
    roughness=orm[...,1]/255
    metallic=orm[...,2]/255 if not clay else np.zeros(orm.shape[:2])
    ao=orm[...,0]/255
    L=np.asarray(light,float);L/=np.linalg.norm(L)
    ndotl=np.maximum(np.sum(normal*L,axis=2),0)
    H=L+np.array([0.,0.,1.]);H/=np.linalg.norm(H)
    ndoth=np.maximum(np.sum(normal*H,axis=2),0)
    spec_power=2/np.maximum(roughness**4,.01)-2
    spec=(spec_power+2)/(2*np.pi)*ndoth**spec_power*.22*strength
    f0=.04*(1-metallic[...,None])+diffuse*metallic[...,None]
    radiance=diffuse*(1-metallic[...,None])*(ambient*ao+strength*ndotl)[...,None]
    radiance+=f0*(spec+(.48+.20*roughness)*metallic*ao)[...,None]
    return rgb(srgb(radiance))

def main():
    images={k:Image.open(ROOT/f'boards_{k}.png') for k in ('base','height','normal','orm')}
    arrays={k:np.asarray(v,dtype=float) for k,v in images.items()}
    masks=np.load(OUT/'construction_masks.npz')
    construction=json.loads((OUT/'construction.json').read_text())
    metrics={'pngs':{},'layout':{},'normals':{},'seams':{}}
    for k,im in images.items():
        raw=(ROOT/f'boards_{k}.png').read_bytes()
        width,height,depth,ctype=struct.unpack('>IIBB',raw[16:26])
        metrics['pngs'][k]={'width':width,'height':height,'bit_depth':depth,
                           'colour_type':ctype,'icc_profile':bool(im.info.get('icc_profile')),
                           'sha256':hashlib.sha256(raw).hexdigest()}
        assert (width,height)==(N,N)
        assert depth==(16 if k=='height' else 8)
        assert ctype==(0 if k=='height' else 2)
        assert bool(im.info.get('icc_profile'))==(k=='base')
    b,h,n,o=(arrays[k] for k in ('base','height','normal','orm'))
    h=h*RANGE/65535
    # Deliberately separate implementation of wrapped central differences.
    gx=(np.concatenate([h[:,1:],h[:,:1]],axis=1)-np.concatenate([h[:,-1:],h[:,:-1]],axis=1))/(2*SCALE)
    gy=(np.concatenate([h[1:,:],h[:1,:]],axis=0)-np.concatenate([h[-1:,:],h[:-1,:]],axis=0))/(2*SCALE)
    expected=np.stack([-gx,gy,np.ones_like(gx)],axis=-1)
    expected/=np.sqrt(np.sum(expected*expected,axis=-1,keepdims=True))
    enc=np.rint((expected*.5+.5)*255)
    assert np.array_equal(enc,n)
    decoded=n/127.5-1
    norms=np.linalg.norm(decoded,axis=2)
    decoded/=norms[...,None]
    angle=np.degrees(np.arccos(np.clip(np.sum(expected*decoded,axis=-1),-1,1)))
    metrics['normals']={'byte_mismatches':int(np.count_nonzero(enc!=n)),
       'mean_angle_degrees':float(angle.mean()),'max_angle_degrees':float(angle.max()),
       'p99_angle_degrees':float(np.percentile(angle,99)),
       'decoded_length_range':[float(norms.min()),float(norms.max())]}
    metrics['base_mean_srgb']=b.mean(axis=(0,1)).tolist()
    assert np.max(np.abs(np.asarray(metrics['base_mean_srgb'])-[172,128,82]))<.02
    # Check every encoded pixel against the frozen pass 6 deliverables. Equality
    # under this exact permutation also proves the normal channels were not rotated.
    metrics['pass7_roll']={'right_px':ROLL_X,'down_px':ROLL_Y,'maps':{}}
    for key,current in arrays.items():
        previous=archived('pass6',key)
        mismatches=int(np.count_nonzero(current!=previous))
        assert mismatches==0, f'{key}: pixels changed beyond the specified roll'
        metrics['pass7_roll']['maps'][key]={'pixel_value_mismatches':mismatches,
            'inverse_roll_recovers_pass6':True}
        with Image.open(OUT/'pass6'/f'boards_{key}.png') as before:
            assert images[key].info.get('icc_profile')==before.info.get('icc_profile')
    with np.load(OUT/'pass6'/'construction_masks.npz') as previous_masks:
        assert set(masks.files)==set(previous_masks.files)
        for key in masks.files:
            assert np.array_equal(masks[key],rolled(previous_masks[key])), key
    metrics['pass7_roll']['construction_masks_preserved_under_roll']=True
    assert construction['revision']==7
    assert construction['final_roll_px']=={'right':512,'down':85,'wrap_around':True}
    assert construction['board_edges_px']==[k*PITCH+85 for k in range(13)]
    assert construction['nail_columns_px']==[512,1536]
    assert construction['butt_joint_x_px']==1536
    assert np.array_equal(masks['board_ids'],np.floor(((np.arange(N)+.5-85)%N)/PITCH).astype(int))
    metrics['pass2_preservation']={}
    for key in ('height','normal','orm'):
        for pass_name in ('pass2','pass3','pass4','pass5'):
            assert np.array_equal(arrays[key],archived(pass_name,key)), (key,pass_name)
        metrics['pass2_preservation'][key]={'pixel_identical_after_roll':True,
            'pre_roll_sha256':hashlib.sha256((OUT/'pass2'/f'boards_{key}.png').read_bytes()).hexdigest()}
    metrics['height_mm']={'full_scale':RANGE,'used_min':float(h.min()),'used_max':float(h.max())}
    metrics['roughness']={'min':float(o[...,1].min()/255),'max':float(o[...,1].max()/255),
                          'std':float(o[...,1].std()/255)}
    assert set(np.unique(o[...,2]).tolist())=={0.,255.}
    assert np.array_equal(o[...,2],masks['metal'])
    frozen_nails=json.loads((ROOT/'source'/'nail_layout.json').read_text())
    assert len(frozen_nails)==len(construction['nails'])==54
    for old,new in zip(frozen_nails,construction['nails']):
        cx,cy=old['center_px']
        expected_nail={**old,'center_px':[(cx+512)%N,(cy+85)%N],'wrap_x':False}
        assert all(new[key]==value for key,value in expected_nail.items())
    old_metal=archived('pass1','orm')[...,2]
    assert np.array_equal(o[...,2],old_metal)
    # Both nail columns, including their complete heads, are now interior.
    regions,count=label(o[...,2]>0)
    assert count==54
    areas=[];errors=[]
    for nail in construction['nails']:
        cx,cy=nail['center_px']
        ix=int(round(cx))%N;iy=int(cy)
        region=regions[iy,ix]
        assert region>0
        yy,xx=np.nonzero(regions==region)
        center=np.array([xx.mean()+.5,yy.mean()+.5])
        errors.append(float(np.linalg.norm(center-[cx,cy])))
        areas.append(len(xx))
    assert max(errors)<.6
    # Detect all lap rows directly from the delivered red channel, away from nails.
    profile=o[:,columns(300,700),0].mean(axis=1)/255
    lap_lines=[]
    for k in range(12):
        edge=k*PITCH+ROLL_Y
        window=(np.arange(int(np.floor(edge))-2,int(np.ceil(edge))+5))%N
        detected=int(window[np.argmin(profile[window])])
        error=((detected+.5-edge+N/2)%N)-N/2
        assert -.6 <= error <= 1.5
        lap_lines.append({'exact_boundary_px':edge,'ao_min_row':detected,'sample_center_error_px':error})
    joint_boards=[]
    for k in range(12):
        rows=board_rows(k,14)
        # Hairline AO at center, excluding nail-height rows.
        median=float(np.median(o[np.ix_(rows,columns(1023,1025))][...,0])/255)
        if median<.85:joint_boards.append(k)
    assert joint_boards==[2,5,9]
    metrics['layout']={'board_count':12,'board_pitch_pixels':PITCH,'board_height_mm':250,
         'lap_lines':lap_lines,'detected_joint_boards':joint_boards,
         'nail_columns_px':[512,1536],'butt_joint_x_px':1536,
         'nails_on_periodic_tile':count,'nail_center_error_max_px':max(errors),
         'nail_areas_px':[min(areas),max(areas)],'metal_mask_mismatches':0,
         'metal_pixels':int((o[...,2]>0).sum())}
    # AO is white on plain faces. All nonwhite pixels must have a named cavity.
    cavity=(masks['lap']>.0001)|(masks['joints']>.001)|(masks['checks']>.005)
    cavity|=(masks['pockets']>.005)|(masks['bruises']>.01)
    # Nail contact rings extend a few pixels outside the head silhouette.
    cavity|=gaussian_filter(masks['nail_coverage'],1.5,mode='wrap')>.002
    unexpected=(o[...,0]<254)&~cavity
    metrics['ao_non_cavity_pixels_below_254']=int(unexpected.sum())
    assert unexpected.sum()==0
    # Mean absolute jump over the entire wrap row/column (all channels),
    # divided by p95 of the mean jumps at the 2047 interior row/column pairs.
    # No nail/cavity exclusions. Height is expressed in equivalent 8-bit codes;
    # normalization cancels in the ratio. Also record the global-interior-mean
    # denominator, which reproduces the failure values quoted in the pass 7 brief.
    for key,arr in arrays.items():
        if arr.ndim==2:arr=arr[...,None]/257
        metrics['seams'][key]={}
        for direction,axis in [('across',1),('down',0)]:
            jump=float(np.abs(np.take(arr,0,axis=axis)-np.take(arr,-1,axis=axis)).mean())
            interior=np.abs(np.diff(arr,axis=axis)).mean(axis=(1-axis,2))
            p95=float(np.percentile(interior,95))
            mean=float(interior.mean())
            ratio=jump/max(p95,1e-9)
            mean_ratio=jump/max(mean,1e-9)
            metrics['seams'][key][direction]={'wrap_jump_mean_255':jump,
                'interior_line_jump_p95_255':p95,'ratio_to_p95':ratio,
                'interior_jump_mean_255':mean,'ratio_to_mean':mean_ratio,
                'limit':4,'pass':ratio<=4}
            assert ratio<=4, f'{key}: {direction} wrap / interior p95 exceeds 4'
            assert mean_ratio<=4, f'{key}: {direction} wrap / interior mean exceeds 4'
    # Remove the added surface components to measure the unchanged arris itself.
    # The delivered surface is measured separately below, including its slopes.
    height_profile=(h-masks['grain_relief']+masks['cup_depth']+masks['saw_depth'])[:,columns(300,700)].mean(axis=1)
    arris_samples=[]
    for k in range(12):
        bottom=(k+1)*PITCH
        face=(int(bottom-12)+ROLL_Y)%N
        last=(int(np.floor(bottom)-1)+ROLL_Y)%N
        arris_samples.append(float(height_profile[face]-height_profile[last]))
    metrics['layout']['sampled_arris_drop_mm']=arris_samples
    assert min(arris_samples)>2.5 and max(arris_samples)<3.2
    # Colour profiles of all boards and board-to-board rhythm.
    means=[]
    for k in range(12):
        means.append(b[board_rows(k,10)].mean(axis=(0,1)).tolist())
    metrics['board_mean_srgb']=means
    metrics['board_mean_luma_std']=float((np.asarray(means)*[.2126,.7152,.0722]).sum(axis=1).std())
    local_y=((np.arange(N)+.5-ROLL_Y)%N)%PITCH
    face=np.broadcast_to(((local_y>14)&(local_y<PITCH-14))[:,None],(N,N)).copy()
    face &= (o[...,2]==0)&(masks['checks']<.05)&(masks['joints']<.01)&(masks['bruises']<.01)
    face[:,columns(1016,1032)]=False
    previous_base=archived('pass2','base')
    luma=np.sum(b*np.array([.2126,.7152,.0722]),axis=2)
    previous_luma=np.sum(previous_base*np.array([.2126,.7152,.0722]),axis=2)
    high=luma-gaussian_filter(luma,(1.3,5),mode='wrap')
    previous_high=previous_luma-gaussian_filter(previous_luma,(1.3,5),mode='wrap')
    contrast=[]
    latewood_delta=[]
    for k in range(12):
        region=face & (masks['board_ids'][:,None]==k)
        old=float(previous_high[region].std())
        new=float(high[region].std())
        contrast.append({'board':k,'pass2_fibre_luma_std':old,'current_fibre_luma_std':new,'ratio':new/old})
        assert new>old*1.25
        dark=high[region & (masks['latewood']>.65)].mean()
        pale=high[region & (masks['latewood']<.12)].mean()
        latewood_delta.append(float(pale-dark))
        assert pale-dark>6
    top=np.mean(means[:2],axis=0)
    bottom=np.mean(means[10:],axis=0)
    # The quieter unlit palette keeps the foot gently greyer and darker.
    assert (bottom[0]-bottom[2])<(top[0]-top[2])-6
    assert np.dot(bottom,[.2126,.7152,.0722])<np.dot(top,[.2126,.7152,.0722])
    assert np.count_nonzero(masks['splash'][(np.arange(1706)+ROLL_Y)%N])==0
    assert np.count_nonzero(masks['dirt_specks']>.1)>100
    for k in (3,6,10):
        assert masks['joint_runoff'][(int(k*PITCH+8)+ROLL_Y)%N,(1024+ROLL_X)%N]>.3
    # Measure worn rims separately from centers; no directional painted glint.
    rim_luma=[];core_luma=[];rim_deltas=[]
    for nail in construction['nails']:
        cx,cy=nail['center_px'];angle=nail['angle_radians'];radius=nail['width_px']/2
        xx=np.arange(int(cx)-5,int(cx)+6)
        yy=np.arange(int(cy)-5,int(cy)+6)
        dy,dx=np.meshgrid(yy+.5-cy,xx+.5-cx,indexing='ij')
        u=dx*np.cos(angle)+dy*np.sin(angle)
        v=-dx*np.sin(angle)+dy*np.cos(angle)
        s=np.maximum.reduce([np.abs(u)/radius,np.abs(v)/(radius*.94),
                            (np.abs(u)+np.abs(v))/(radius*1.68)])
        patch=luma[np.ix_(yy%N,xx%N)]
        rim=float(patch[(s>.65)&(s<.88)].mean())
        core=float(patch[s<.35].mean())
        rim_luma.append(rim);core_luma.append(core);rim_deltas.append(rim-core)
    assert min(rim_deltas)>10
    metrics['pass3_colour']={'fibre_contrast_by_board':contrast,
        'mean_fibre_contrast_ratio':float(np.mean([v['ratio'] for v in contrast])),
        'earlywood_minus_latewood_highpass_luma_by_board':latewood_delta,
        'top_two_mean_srgb':top.tolist(),'bottom_two_mean_srgb':bottom.tolist(),
        'splash_board_indices':[10,11], 'runoff_below_joint_board_indices':[3,6,10],
        'dirt_pixels_above_point_one':int(np.count_nonzero(masks['dirt_specks']>.1)),
        'nail_core_mean_luma':float(np.mean(core_luma)),
        'nail_worn_rim_mean_luma':float(np.mean(rim_luma)),
        'nail_rim_minus_core_min_luma':min(rim_deltas)}
    # DESIGN.md bounds apply to board averages, not individual grain/knot pixels.
    # Measure both complete boards and cavity-free faces on the delivered PNG.
    pass4_base=archived('pass4','base')
    pass5_base=archived('pass5','base')
    pass5_luma=np.sum(pass5_base*np.array([.2126,.7152,.0722]),axis=2)
    pass5_high=pass5_luma-gaussian_filter(pass5_luma,(1.3,5),mode='wrap')
    low_bound=np.array([160,117,75]);high_bound=np.array([184,141,96])
    board_colour=[]
    for k in range(12):
        rows=masks['board_ids']==k
        region=face & rows[:,None]
        before=mean_ls(pass5_base[rows]);after=mean_ls(b[rows])
        pass4_mean=pass4_base[rows].mean(axis=(0,1))
        board_mean=b[rows].mean(axis=(0,1));face_mean=b[region].mean(axis=0)
        assert np.all((board_mean>=low_bound)&(board_mean<=high_bound)), (k,board_mean)
        assert np.all((face_mean>=low_bound)&(face_mean<=high_bound)), (k,face_mean)
        assert after[1]<before[1], (k,before,after)
        # Leave space around iron/halo compositing and filter support. Elsewhere
        # a constant offset preserves every feature, up to 8-bit rounding.
        region[:,columns(-60,60)]=False;region[:,columns(964,1084)]=False
        region &= np.all((pass5_base>0)&(pass5_base<255),axis=2)
        delta=b[region]-pass5_base[region]
        residual_std=delta.std(axis=0)
        assert np.max(residual_std)<.51, (k,residual_std)
        ratio=float(high[region].std()/pass5_high[region].std())
        assert .995<ratio<1.005, (k,ratio)
        board_colour.append({'board':k,'before_mean_LS':before,
            'after_mean_LS':after,'pass4_mean_srgb':pass4_mean.tolist(),
            'before_mean_srgb':pass5_base[rows].mean(axis=(0,1)).tolist(),
            'after_mean_srgb':board_mean.tolist(),'face_mean_srgb':face_mean.tolist(),
            'rgb_offset_residual_std_codes':residual_std.tolist(),
            'fibre_contrast_ratio_to_pass5':ratio})
    pass4_means=np.array([v['pass4_mean_srgb'] for v in board_colour])
    current_means=np.array([v['after_mean_srgb'] for v in board_colour])
    spread_ratio=np.ptp(current_means,axis=0)/np.ptp(pass4_means,axis=0)
    centered_error=(current_means-current_means.mean(axis=0))-.8*(pass4_means-pass4_means.mean(axis=0))
    assert np.max(np.abs(centered_error))<.03
    assert np.all((spread_ratio>.79)&(spread_ratio<.81))
    luma_weights=np.array([.2126,.7152,.0722])
    luma_spread_ratio=float((current_means@luma_weights).std()/(pass4_means@luma_weights).std())
    assert .79<luma_spread_ratio<.81
    after=np.array([v['after_mean_LS'] for v in board_colour])
    assert set(np.argsort(after[:,0])[-2:])=={4,7}
    assert np.array_equal(np.argsort(current_means@luma_weights),np.argsort(pass4_means@luma_weights))
    ordinary=after[[0,1,2,3,5,8]].mean(axis=0)
    assert np.all(after[10:]<ordinary)
    iron=masks['nail_coverage']==1
    assert np.array_equal(b[iron],pass5_base[iron])
    assert images['base'].info['icc_profile']==Image.open(OUT/'pass5'/'boards_base.png').info['icc_profile']
    previous_construction=json.loads((OUT/'pass5'/'construction.json').read_text())
    for old,new in zip(previous_construction['nails'],construction['nails']):
        cx,cy=old['center_px']
        assert new=={**old,'center_px':[(cx+ROLL_X)%N,(cy+ROLL_Y)%N],'wrap_x':False}
    assert construction['board_edges_px']==[y+ROLL_Y for y in previous_construction['board_edges_px']]
    for board in construction['boards']:
        assert board['knot_centres_tile_px']==[
            [(x+ROLL_X)%N,(board['index']*PITCH+y+ROLL_Y)%N,rx,ry]
            for x,y,rx,ry in board['knot_centres_local_px']]
    # All non-palette per-board construction metadata remains identical too.
    for old,new in zip(previous_construction['boards'],construction['boards']):
        for key,value in old.items():
            if key!='pass5_additive_srgb_offset': assert new[key]==value, (new['index'],key)
    with np.load(OUT/'pass5'/'construction_masks.npz') as previous_masks:
        assert set(masks.files)==set(previous_masks.files)
        for key in masks.files:
            assert np.array_equal(masks[key],rolled(previous_masks[key])), key
    metrics['pass6_colour']={'boards':board_colour,
        'before_mean_srgb':pass5_base.mean(axis=(0,1)).tolist(),
        'after_mean_srgb':metrics['base_mean_srgb'],
        'board_mean_bounds_srgb':[low_bound.tolist(),high_bound.tolist()],
        'board_mean_min_srgb':current_means.min(axis=0).tolist(),
        'board_mean_max_srgb':current_means.max(axis=0).tolist(),
        'before_mean_LS':mean_ls(pass5_base),'after_mean_LS':mean_ls(b),
        'pass4_board_RGB_range':np.ptp(pass4_means,axis=0).tolist(),
        'after_board_RGB_range':np.ptp(current_means,axis=0).tolist(),
        'RGB_range_ratio_to_pass4':spread_ratio.tolist(),
        'board_luma_std_ratio_to_pass4':luma_spread_ratio,
        'centered_board_RGB_max_error_from_80_percent':np.max(np.abs(centered_error),axis=0).tolist(),
        'clipped_channel_values_at_0_or_255':int(np.count_nonzero((b==0)|(b==255))),
        'opaque_iron_pixels_byte_identical':True,
        'all_construction_masks_identical_to_pass5_after_roll':True,
        'height_normal_orm_identical_to_pass5_after_roll':True}
    deviation=np.degrees(np.arccos(np.clip(expected[...,2],-1,1)))
    old_normal=archived('pass1','normal')/127.5-1
    old_normal/=np.linalg.norm(old_normal,axis=2,keepdims=True)
    old_deviation=np.degrees(np.arccos(np.clip(old_normal[...,2],-1,1)))
    cup_depths=[x['cup_depth_mm'] for x in construction['boards']]
    saw_max=[float(masks['saw_depth'][board_rows(k,1)].max()) for k in range(12)]
    grain_spans=[float(np.diff(np.percentile(masks['grain_relief'][board_rows(k,1)],[5,95]))[0]) for k in range(12)]
    assert all(1<=v<=2 for v in cup_depths)
    assert all(.2<v<=.4 for v in saw_max)
    assert all(.5<v<1 for v in grain_spans)
    assert np.percentile(deviation[face],90)>10
    assert np.percentile(deviation[face],50)>np.percentile(old_deviation[face],50)
    metrics['surface']={'face_normal_deviation_p50_p90_p99_degrees':np.percentile(deviation[face],[50,90,99]).tolist(),
        'pass1_same_face_deviation_p50_p90_p99_degrees':np.percentile(old_deviation[face],[50,90,99]).tolist(),
        'cup_depth_by_board_mm':cup_depths,'saw_peak_depth_by_board_mm':saw_max,
        'grain_relief_p05_p95_span_by_board_mm':grain_spans,
        'head_interior_mean_srgb':b[(masks['nail_coverage']>.99)&(o[...,2]>0)].mean(axis=0).tolist(),
        'unchanged_pass1_metal_silhouette_after_roll':True,
        'hammer_bruise_count':sum(n['hammer_bruise'] for n in construction['nails']),
        'rust_streak_count':sum(n['rain_streak'] for n in construction['nails'])}
    (OUT/'metrics.json').write_text(json.dumps(metrics,indent=2)+'\n')

    height_view=rgb(h/RANGE*255)
    panels=[('BASE / sRGB reflectance',images['base']),('HEIGHT / 0–12 mm',height_view),
            ('NORMAL / OpenGL',images['normal']),('ORM / linear R G B',images['orm'])]
    layers=sheet('layers.jpg',panels,4,512)
    offsets=[]
    for name,im in [('base',images['base']),('height',height_view),('normal',images['normal']),('orm',images['orm'])]:
        offset=rgb(np.roll(np.roll(np.asarray(im),N//2,axis=0),N//2,axis=1))
        offset.save(OUT/f'{name}_half_offset.png')
        offsets.append((name.upper()+' / half-tile wrap',offset))
    sheet('offsets.jpg',offsets,4,512)
    # The current wrap crosses (1024,1024); the old x=0 nail column and y=0
    # lap now cross at (1536,1109) in these half-offset views.
    seam_details=[]
    for caption,box in [('Current wrap / mid-board',(896,896,1152,1152)),
                      ('Former edge / lap + nails',(1408,981,1664,1237))]:
        for name,im in offsets:
            crop=im.crop(box).resize((512,512),Image.Resampling.NEAREST)
            seam_details.append((name.split(' / ')[0]+' / '+caption,crop))
    sheet('half_offset_seam_detail.png',seam_details,4,512)
    tilebase=rgb(np.tile(b.astype(np.uint8),(3,3,1)))
    tilebase.save(OUT/'base_tile_3x3.jpg',quality=95)
    tiny=images['base'].resize((96,96),Image.Resampling.LANCZOS)
    tiny_tile=rgb(np.tile(np.asarray(tiny),(3,3,1))).resize((864,864),Image.Resampling.NEAREST)
    # 13-degree elevation from upper-left makes the wood's actual slopes visible.
    # Both maps use their delivered normal/ORM; there is no normal-strength boost.
    lit=[]
    for title,light,amb,power,name in [
        ('Upper left / raking 13 deg',[-.40,.89,.23],.15,2.8,'lit_upper_left.png'),
        ('Lower right / 33 deg',[.55,-.65,.55],.25,1.1,'lit_lower_right.png')]:
        im=relight(b,decoded,o,light,amb,power)
        im.save(OUT/name)
        lit.append((title,im))
    clay=relight(b,decoded,o,[-.40,.89,.23],.15,2.8,clay=True)
    clay.save(OUT/'relief_upper_left.png')
    assert np.array_equal(np.asarray(clay),rolled(np.asarray(Image.open(OUT/'pass6'/'relief_upper_left.png'))))
    for name in ('lit_upper_left.png','lit_lower_right.png'):
        assert np.array_equal(np.asarray(Image.open(OUT/name)),rolled(np.asarray(Image.open(OUT/'pass6'/name))))
    old_base=archived('pass6','base')
    old_lit=relight(old_base,decoded,o,[-.40,.89,.23],.15,2.8)
    comparison_box=(780,280,1292,792)
    sheet('pass_comparison.jpg',[
        ('Pass 6 / original tile',Image.open(OUT/'pass6'/'boards_base.png')),
        ('Pass 7 / complete wall albedo',images['base']),
        ('Pass 6 aligned / native albedo',detail_crop(rgb(old_base),comparison_box)),
        ('Pass 7 / native albedo',detail_crop(images['base'],comparison_box)),
        ('Pass 6 aligned / same raking light',detail_crop(old_lit,comparison_box)),
        ('Pass 7 / same raking light',detail_crop(lit[0][1],comparison_box)),
        ('Pass 6 aligned / wall foot / native',detail_crop(rgb(old_base),(760,1536,1272,2048))),
        ('Pass 7 / wall foot / native',detail_crop(images['base'],(760,1536,1272,2048)))],2,512)
    sheet('relighting.jpg',lit,2,1024)
    sheet('tilings.jpg',[('3 × 3 / nine metres of wall',tilebase),
                         ('Distance / 96 pixels per 3 m tile',tiny_tile),
                         ('Upper-left light / 3 × 3',rgb(np.tile(np.asarray(lit[0][1]),(3,3,1)))),
                         ('Half-offset / seam inspection',offsets[0][1])],2,768)
    # Exact pixel-scale crop plus a magnified joint/nail crop in all four layers.
    boxes=[(850,280,1234,664),(0,940,384,1324),(360,130,744,514)]
    crops=[]
    for i,box in enumerate(boxes):
        for name,im in [('Base',images['base']),('Height',height_view),('Raking light',lit[0][1]),('Normal',images['normal'])]:
            crops.append((f'{name} / detail {i+1} / native pixels',detail_crop(im,box)))
    sheet('native_detail.jpg',crops,4,384)
    surface_boxes=[(780,280,1292,792),(300,460,812,972),(1120,1320,1632,1832)]
    surface=[]
    for i,box in enumerate(surface_boxes):
        for title,im in [('Base',images['base']),('Raking light',lit[0][1]),('Relief only',clay)]:
            surface.append((f'{title} / crop {i+1} / 1:1',detail_crop(im,box)))
    sheet('surface_native.png',surface,3,512)
    # Follow the near-lap pair on joint board 2 through the final roll.
    pairbox=(985,375,1063,501)
    nail_panels=[]
    for name,im in [('Base',images['base']),('Height',height_view),('Normal',images['normal']),('ORM',images['orm'])]:
        crop=detail_crop(im,pairbox).resize((468,756),Image.Resampling.NEAREST)
        canvas=Image.new('RGB',(756,756),(24,23,22));canvas.paste(crop,(144,0))
        nail_panels.append((name+' / joint and forged heads ×6',canvas))
    sheet('nail_alignment.jpg',nail_panels,4,512)
    head_box=(996,375,1020,399)
    head_panels=[]
    for title,im in [('Iron albedo',images['base']),('Upper-left light',lit[0][1]),
                     ('Lower-right light',lit[1][1]),('Relief only',clay)]:
        head_panels.append((title+' / nearest pixels',detail_crop(im,head_box).resize((384,384),Image.Resampling.NEAREST)))
    sheet('forged_head_detail.png',head_panels,4,384)
    sheet('nail_before_after.png',[
        ('Pass 6 aligned / iron / nearest x16',detail_crop(rgb(old_base),head_box).resize((384,384),Image.Resampling.NEAREST)),
        ('Pass 7 / iron / nearest x16',detail_crop(images['base'],head_box).resize((384,384),Image.Resampling.NEAREST))],2,384)
    # Whole-width strips at native pixel scale make figure variety reviewable.
    characters=Image.new('RGB',(N,12*204),(24,23,22))
    cd=ImageDraw.Draw(characters)
    for k,board in enumerate(construction['boards']):
        y=k*204
        cd.text((12,y+5),f"{k:02d}  {board['character']}",font=font(18),fill=(233,227,215))
        characters.paste(detail_crop(images['base'],(0,int(k*PITCH),N,int((k+1)*PITCH))),(0,y+32))
    characters.save(OUT/'board_character.jpg',quality=97)
    overlay=images['base'].copy();draw=ImageDraw.Draw(overlay)
    for k in range(12):
        y=k*PITCH+ROLL_Y
        draw.line((0,y,N,y),fill=(120,224,230),width=1)
        draw.text((25,y+12),f'{k:02d} | y={y:.3f}',font=font(20),fill=(245,245,239))
        if k in (2,5,9):draw.line((1536,y,1536,y+PITCH),fill=(250,110,90),width=2)
    for nail in construction['nails']:
        x,y=nail['center_px']
        draw.ellipse((x-7,y-7,x+7,y+7),outline=(245,215,100),width=1)
    overlay.save(OUT/'layout_overlay.png')
    sheet('contact_sheet.jpg',[
        ('BEFORE / pass 6 / original tile',Image.open(OUT/'pass6'/'boards_base.png')),
        ('AFTER / pass 7 / albedo',images['base']),
        ('BEFORE / pass 6 aligned / native albedo',detail_crop(rgb(old_base),comparison_box)),
        ('AFTER / pass 7 / native albedo',detail_crop(images['base'],comparison_box)),
        ('BEFORE / pass 6 aligned / raking light',detail_crop(old_lit,comparison_box)),
        ('AFTER / pass 7 / identical light',detail_crop(lit[0][1],comparison_box)),
        panels[1],panels[2],panels[3],
        ('3 × 3 repeat',tilebase),('Distance read',tiny_tile),
        ('Half-offset albedo',offsets[0][1]),('Exact layout overlay',overlay),
        ('Wall foot / native pigment',detail_crop(images['base'],(760,1536,1272,2048))),
        ('Worn iron / nearest pixels',detail_crop(images['base'],head_box).resize((512,512),Image.Resampling.NEAREST)),
        ('Relief only / same native crop',detail_crop(clay,surface_boxes[0]))],4,512)
    print(json.dumps({k:metrics[k] for k in ['base_mean_srgb','height_mm','normals','roughness','seams',
                      'ao_non_cavity_pixels_below_254','board_mean_luma_std','surface',
                      'pass2_preservation','pass3_colour','pass6_colour','pass7_roll']},indent=2))
    print('PASS: formats, normals, shifted layout, both wrap ratios <= 4, half-offset seam views, binary metalness, cavity-only AO, all four pass 6 maps exactly rolled +512 x / +85 y; pass 2/3/4/5 physical pixels preserved under roll, unlit B target mean, board and face means within B- to B+, 80% of pass 4 board RGB spread, pass 5 fibre/figure contrast preserved, all construction masks preserved, darker latewood, wall-height weathering, unchanged iron and worn rims.')

if __name__=='__main__':
    main()
