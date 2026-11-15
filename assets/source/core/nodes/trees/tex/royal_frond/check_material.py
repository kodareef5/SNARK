#!/usr/bin/env python3
"""Independent saved-PNG verification and review images. Run after build_material.py."""
from pathlib import Path
import json
import struct
import hashlib
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage as ndi

ROOT = Path(__file__).resolve().parent
CHECKS = ROOT/'checks'
LAYOUT = json.loads((ROOT/'guide/LAYOUT.json').read_text())
N = 2048
PREFIX = 'royal_frond_'
GREY = (128,128,128)
SKY = (180,207,226)


def font(size):
    for path in ['/System/Library/Fonts/Supplemental/Arial.ttf',
                 '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf']:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def composite(color, alpha, bg, cut=False):
    a = (alpha >= .5).astype(float) if cut else alpha
    return Image.fromarray(np.rint(color*a[...,None]+np.array(bg)*(1-a[...,None])).clip(0,255).astype(np.uint8))


def thumb(im, size):
    return im.resize((size,size), Image.Resampling.LANCZOS)


def sheet(panels, cols, size=700):
    rows = (len(panels)+cols-1)//cols
    result = Image.new('RGB', (cols*size, rows*(size+42)), (24,29,28))
    d = ImageDraw.Draw(result)
    for i,(name,im) in enumerate(panels):
        x = (i%cols)*size; y = (i//cols)*(size+42)
        d.text((x+14,y+11), name, font=font(18), fill=(226,232,224))
        result.paste(thumb(im, size),(x,y+42))
    return result


def resize_data(a, n):
    if a.ndim == 2:
        return np.asarray(Image.fromarray(a.astype(np.float32)).resize((n,n), Image.Resampling.BOX))
    return np.stack([resize_data(a[...,k], n) for k in range(a.shape[-1])],-1)


def png_header(path):
    b = path.read_bytes()
    width, height, depth, color = struct.unpack('>IIBB', b[16:26])
    return dict(size=[width,height], bit_depth=depth, color_type=color,
                sha256=hashlib.sha256(b).hexdigest())


def srgb_to_linear(c):
    c = c/255
    return np.where(c <= .04045, c/12.92, ((c+.055)/1.055)**2.4)


def linear_to_srgb(c):
    return 255*np.where(c <= .0031308, 12.92*c, 1.055*np.maximum(c,0)**(1/2.4)-.055)


def light_preview(rgb, normal, orm, alpha, light):
    l = np.array(light); l = l/np.linalg.norm(l)
    ndl = np.maximum(np.sum(normal*l, -1),0)
    half = l+np.array([0,0,1]); half /= np.linalg.norm(half)
    ndh = np.maximum(np.sum(normal*half,-1),0)
    rough = orm[...,1]/255
    power = np.maximum(2/np.maximum(rough,.05)**4-2, 2)
    spec = ndh**power * (.11*(1-rough))
    lit = srgb_to_linear(rgb)*(.24+.88*ndl[...,None])*(orm[...,0:1]/255)
    lit += spec[...,None]
    color = linear_to_srgb(lit)
    return composite(color, alpha, (173,196,210), cut=True)


def filtered_crop(a, box, size):
    x0,y0,x1,y1=box
    cut=a[y0:y1,x0:x1]
    if cut.ndim==3:
        return np.stack([np.asarray(Image.fromarray(cut[...,ch].astype(np.float32)).resize(size, Image.Resampling.BILINEAR)) for ch in range(cut.shape[-1])], -1)
    return np.asarray(Image.fromarray(cut.astype(np.float32)).resize(size, Image.Resampling.BILINEAR))

def check_round2_detail(data, original, metadata, metrics, filtered_crop):
    """Measure isolated, paired flanks from the saved maps and curve records.

    No renderer imports: test the visible result at corresponding physical
    locations, rejecting crossings where another leaflet covers either flank.
    """
    ids = np.asarray(Image.open(ROOT/'source/leaflet_ids.png'))
    old_ids = np.asarray(Image.open(ROOT/'source/round1/leaflet_ids.png'))
    old_height = np.asarray(Image.open(ROOT/'source/round1/royal_frond_height.png'))
    old_normal = np.asarray(Image.open(ROOT/'source/round1/royal_frond_normal.png'))
    def sample(a, points, order=1):
        coords = [points[:,1], points[:,0]]
        if a.ndim == 3:
            return np.stack([ndi.map_coordinates(a[...,c], coords, order=order, output=np.float64) for c in range(a.shape[-1])], -1)
        return ndi.map_coordinates(a, coords, order=order, output=np.float64)
    def unit(n):
        n=n/255*2-1
        return n/np.linalg.norm(n,axis=-1,keepdims=True)
    slots=[]
    for slot in range(3):
        rows=[]
        leaves=[leaf for leaf in metadata['leaves'] if leaf['slot']==slot]
        for number,leaf in enumerate(leaves,1):
            cp=np.array(leaf['control'])
            for t in [.22,.34,.46,.58,.70]:
                if t > leaf['end']-.05: continue
                center=(1-t)**3*cp[0]+3*(1-t)**2*t*cp[1]+3*(1-t)*t*t*cp[2]+t**3*cp[3]
                tangent=3*(1-t)**2*(cp[1]-cp[0])+6*(1-t)*t*(cp[2]-cp[1])+3*t*t*(cp[3]-cp[2])
                tangent/=np.linalg.norm(tangent)
                cross=np.array([-tangent[1],tangent[0]])
                metric=np.linalg.norm(cross/np.array([LAYOUT['pixels_per_metre_across'],LAYOUT['pixels_per_metre_along']]))
                offset=leaf['width_m']/metric*.24
                if offset<2: continue
                points=center+np.array([-1,0,1])[:,None]*cross*offset
                if not np.all(sample(ids,points,0)==number): continue
                if not np.all(sample(old_ids,points,0)==number): continue
                if not np.all(sample(data['base'][...,3],points)>250): continue
                h=sample(data['height'],points)/65535*10
                oh=sample(old_height,points)/65535*10
                n=unit(sample(data['normal'],points))
                on=unit(sample(old_normal,points))
                c=sample(data['base'][...,:3],points)
                oc=sample(original[...,:3],points)
                rough=sample(data['orm'][...,1],points)/255
                world=np.array([cross[0]/LAYOUT['pixels_per_metre_across'],-cross[1]/LAYOUT['pixels_per_metre_along'],0])
                world/=np.linalg.norm(world)
                rows.append([h[1]-(h[0]+h[2])*.5,oh[1]-(oh[0]+oh[2])*.5,
                    np.rad2deg(np.arccos(np.clip(n[0]@n[2],-1,1))),
                    np.rad2deg(np.arccos(np.clip(on[0]@on[2],-1,1))),
                    c[2,1]-c[0,1],oc[2,1]-oc[0,1],
                    c[1,1]-(c[0,1]+c[2,1])*.5,
                    (n[0]@world<-.03) and (n[2]@world>.03),
                    (rough[0]+rough[2])*.5-rough[1]])
        a=np.array(rows)
        assert len(a)>35, 'Too few isolated paired blade samples'
        med=np.median(a,axis=0)
        result=dict(slot=slot, paired_samples=len(a),
            median_crease_rise_mm=float(med[0]), previous_crease_rise_mm=float(med[1]),
            median_flank_normal_separation_degrees=float(med[2]), previous_separation_degrees=float(med[3]),
            median_flank_green_difference=float(med[4]), previous_flank_green_difference=float(med[5]),
            median_vein_green_above_flanks=float(med[6]), opposing_flank_normal_fraction=float(a[:,7].mean()),
            median_crease_roughness_reduction=float(med[8]))
        assert med[0]>1.0 and med[2]>14
        assert med[4]>7 and med[6]>3
        assert a[:,7].mean()>.85
        if slot<2: assert med[8]>.015, 'Crease lost its waxy roughness stripe'
        slots.append(result)
    metrics['round2']['paired_blade_samples']=slots
    # Measure the ramp from the delivered 8-bit alpha, along local edge normals.
    # Only use isolated edges with a complete monotonic 0-to-1 crossing.
    a=data['base'][...,3]/255
    gy,gx=np.gradient(ndi.gaussian_filter(a,.5)); mag=np.hypot(gx,gy)
    y,x=np.nonzero((a>.32)&(a<.68)&(mag>.25)); y=y[::35]; x=x[::35]
    d=np.linspace(-3,3,121)
    xx=x[:,None]+d*gx[y,x,None]/mag[y,x,None]
    yy=y[:,None]+d*gy[y,x,None]/mag[y,x,None]
    profiles=ndi.map_coordinates(a,[yy,xx],order=1)
    valid=(profiles[:,0]<.01)&(profiles[:,-1]>.99)&(np.diff(profiles,axis=1).min(axis=1)>-.006)
    widths=np.array([np.interp(.9,v,d)-np.interp(.1,v,d) for v in profiles[valid]])
    assert len(widths)>500 and 1.0<np.median(widths)<2.0
    metrics['round2']['alpha_transition_10_to_90_percent']=dict(samples=len(widths),
        width_px_percentiles_0_10_50_90_100=np.percentile(widths,[0,10,50,90,100]).tolist())
    # Show alpha values and reconstruct the .5 contour after magnification.
    box=(485,945,565,1025); size=(640,640)
    edge=Image.new('RGB',(1280,1380),(25,30,28)); d=ImageDraw.Draw(edge)
    for col,(name,rgba) in enumerate([('Round 1',original),('Round 2',data['base'])]):
        a=filtered_crop(rgba[...,3]/255,box,size)
        c=filtered_crop(rgba[...,:3],box,size)
        d.text((col*640+10,12),name+' / fractional alpha / 8x bilinear',font=font(18),fill=(229,234,223))
        edge.paste(Image.fromarray(np.rint(a*255).astype(np.uint8)).convert('RGB'),(col*640,42))
        d.text((col*640+10,702),name+' / filtered RGB + alpha cut 0.5',font=font(18),fill=(229,234,223))
        edge.paste(composite(c,a,SKY,cut=True),(col*640,740))
    edge.save(CHECKS/'alpha_edge_detail.png')
    # Shared filtering makes the surface comparison independent of presentation.
    comparison=Image.new('RGB',(1800,1040),(25,30,28)); d=ImageDraw.Draw(comparison)
    for col,slot in enumerate(LAYOUT['slots']):
        cx=int(slot['midrib_x']); box=(cx-150,910,cx+150,1150)
        for row,(name,rgba) in enumerate([('Round 1',original),('Round 2',data['base'])]):
            c=filtered_crop(rgba[...,:3],box,(600,480))
            a=filtered_crop(rgba[...,3]/255,box,(600,480))
            d.text((col*600+10,row*520+10),f'{name} / slot {col} / unlit',font=font(18),fill=(229,234,223))
            comparison.paste(composite(c,a,GREY,cut=True),(col*600,row*520+40))
    comparison.save(CHECKS/'round2_comparison.jpg',quality=96)


def main():
    CHECKS.mkdir(exist_ok=True)
    (CHECKS/'metrics.json').write_text(json.dumps({'passed':False,'status':'Checks running'})+'\n')
    ims = {k:Image.open(ROOT/(PREFIX+k+'.png')) for k in ['base','height','normal','orm']}
    data = {k:np.asarray(v) for k,v in ims.items()}
    rgba = data['base']; rgb = rgba[...,:3].astype(float); alpha = rgba[...,3]/255.
    height = data['height'].astype(float)/65535
    normal = data['normal'].astype(float)/255*2-1
    normal_length = np.linalg.norm(normal,axis=-1)
    normal /= normal_length[...,None]
    orm = data['orm']
    metadata = json.loads((ROOT/'source/composition.json').read_text())
    original = np.asarray(Image.open(ROOT/'source/round1/royal_frond_base.png'))
    old_metadata = json.loads((ROOT/'source/round1/composition.json').read_text())
    assert metadata['leaves'] == old_metadata['leaves'], 'Blade layout or width changed'
    assert metadata['height_range_mm'] == 10.0
    assert (ROOT/'outline.json').read_bytes() == (ROOT/'source/round1/outline.json').read_bytes()
    old_cut = original[...,3] >= 128
    new_cut = rgba[...,3] >= 128
    assert np.array_equal(old_cut, new_cut), 'Shipped 0.5 outline changed'
    # Every interior/exterior contour sample must participate in a fractional
    # ramp. A binary cut cannot pass this check just by adding isolated values.
    border_in = new_cut & ~ndi.binary_erosion(new_cut, border_value=1)
    border_out = ~new_cut & ndi.binary_dilation(new_cut)
    partial = (rgba[...,3] > 0) & (rgba[...,3] < 255)
    # The bare-stalk boundary cannot receive an outward convolution tail. Its
    # contour still has partial coverage on the interior side of the edge.
    protected = np.zeros_like(border_out)
    rows=np.arange(N)>=np.ceil(N-1-LAYOUT['bare_stalk_m']*LAYOUT['pixels_per_metre_along'])
    for slot in LAYOUT['slots']:
        xx=np.arange(slot['x0'],slot['x1'])
        protected[:,slot['x0']:slot['x1']]=rows[:,None] & (np.abs(xx-slot['midrib_x'])>7.5)[None,:]
    assert np.all(partial[border_in]), 'Hard interior alpha edge remains'
    assert np.all(partial[border_out & ~protected]), 'Hard exterior alpha edge remains'
    alpha_values = np.unique(rgba[...,3])
    assert len(alpha_values) > 128, 'Insufficient subpixel coverage levels'
    revision = dict(native_cutout_changed_pixels=int(np.count_nonzero(old_cut ^ new_cut)),
        new_opaque_pixels_outside_old_cutout=int(np.count_nonzero(new_cut & ~old_cut)),
        blade_records_unchanged=True, fitted_outline_file_unchanged=True,
        alpha_unique_values=len(alpha_values), fractional_alpha_pixels=int(partial.sum()),
        contour_samples=int((border_in | border_out).sum()),
        contour_samples_with_fractional_alpha=int(partial[border_in | border_out].sum()),
        exterior_fringe_samples_excluded_by_bare_stalk=int((border_out & protected).sum()),
        alpha_filter=metadata['alpha_filter'])
    m = dict(files={}, height_range_mm=metadata['height_range_mm'],
             physical_slot_metres=[1.6,4.2], alpha_cutoff=.5,
             mip_filter='BOX, repeated half reduction (equivalent to area average)',
             coverage_definition='Cutout pixels / fractional area of native row-by-row silhouette envelope. Each native occupied row is filled between its leftmost and rightmost alpha>=0.5 sample; envelope area is box filtered without thresholding. Also report cutout/native cutout area retention and whole-slot occupancy.',
             slots=[], normal_height_agreement={}, round2=revision)
    for k,im in ims.items():
        info = png_header(ROOT/(PREFIX+k+'.png'))
        info['mode'] = im.mode; info['icc_profile'] = bool(im.info.get('icc_profile'))
        info['png_metadata_keys'] = list(im.info)
        m['files'][k] = info
        assert info['size'] == [N,N]
        assert info['bit_depth'] == (16 if k == 'height' else 8)
        assert info['color_type'] == {'base':6,'height':0,'normal':2,'orm':2}[k]
        assert info['icc_profile'] == (k == 'base')
        if k != 'base':
            assert 'gamma' not in im.info and 'srgb' not in im.info
    assert np.count_nonzero(orm[...,2]) == 0
    m['metalness_nonzero_pixels'] = int(np.count_nonzero(orm[...,2]))
    # Independent normal calculation directly from the saved 16-bit PNG.
    mm = height*metadata['height_range_mm']
    ddx = np.empty_like(mm); ddy = np.empty_like(mm)
    pitch_x = 1000/LAYOUT['pixels_per_metre_across']
    pitch_y = 1000/LAYOUT['pixels_per_metre_along']
    ddx[:,1:-1] = (mm[:,2:]-mm[:,:-2])/(2*pitch_x)
    ddx[:,0] = (mm[:,1]-mm[:,0])/pitch_x; ddx[:,-1] = (mm[:,-1]-mm[:,-2])/pitch_x
    ddy[1:-1] = (mm[2:]-mm[:-2])/(2*pitch_y)
    ddy[0] = (mm[1]-mm[0])/pitch_y; ddy[-1] = (mm[-1]-mm[-2])/pitch_y
    expected = np.stack([-ddx,ddy,np.ones_like(ddx)],-1)
    expected /= np.linalg.norm(expected,axis=-1,keepdims=True)
    angular = np.rad2deg(np.arccos(np.clip((normal*expected).sum(-1),-1,1)))
    sel = alpha >= .5
    m['normal_height_agreement'] = dict(mean_degrees=float(angular[sel].mean()),
          p99_degrees=float(np.percentile(angular[sel],99)), max_degrees=float(angular[sel].max()),
          all_pixels_max_degrees=float(angular.max()),
          encoded_length_min=float(normal_length.min()), encoded_length_max=float(normal_length.max()),
          pitch_mm=[pitch_x,pitch_y], convention='+X right; +Y up; +Z outward')
    assert angular.max() < .41
    envelope = np.zeros((N,N),np.float32)
    for slot in LAYOUT['slots']:
        x0,x1 = slot['x0'],slot['x1']
        a = alpha[:,x0:x1]; opaque = a >= .5
        margin = LAYOUT['margin_px']
        outside = np.concatenate([a[:,:margin],a[:,-margin:]],axis=1)
        err_count = int(np.count_nonzero(outside))
        assert err_count == 0
        for y in range(N):
            xx = np.flatnonzero(opaque[y])
            if len(xx):
                envelope[y,x0+xx[0]:x0+xx[-1]+1] = 1
        _, ii = ndi.distance_transform_edt(~opaque, return_indices=True)
        c = rgb[:,x0:x1]
        err = np.abs(c-c[tuple(ii)])[a==0]
        assert err.max() == 0
        labels,count = ndi.label(opaque, structure=np.ones((3,3)))
        sizes = np.bincount(labels.ravel())[1:]
        _, support_count = ndi.label(a>0, structure=np.ones((3,3)))
        assert count == 1 and support_count == 1
        foot_weights = a[-100:].sum(axis=0)
        foot_center = float(np.sum(foot_weights*np.arange(x0,x1))/foot_weights.sum())
        center_error = abs(foot_center-slot['midrib_x'])
        assert center_error < .05
        stalk_rows = np.arange(N) >= np.ceil(N-1-LAYOUT['bare_stalk_m']*LAYOUT['pixels_per_metre_along'])
        xx = np.arange(x0,x1)
        away_from_stalk = np.abs(xx-slot['midrib_x']) > 7.5
        bare_strays = int(np.count_nonzero(a[np.ix_(stalk_rows,away_from_stalk)]))
        assert bare_strays == 0
        leaf = [v for v in metadata['leaves'] if v['slot']==slot['slot']]
        s = dict(slot=slot['slot'], leaflet_count=len(leaf),
                 broken_leaflets=sum(v['broken'] for v in leaf),
                 split_tips=sum(v['split'] for v in leaf),
                 alpha_nonzero_pixels_outside_margins=err_count,
                 alpha_mass_outside_margins=float(outside.sum()),
                 transparent_rgb_nearest_leaf_max_error=float(err.max()),
                 native_components=int(count),
                 nonzero_alpha_components=int(support_count),
                 measured_stalk_center_x=foot_center, stalk_center_error_px=center_error,
                 bare_stalk_m=LAYOUT['bare_stalk_m'], bare_stalk_stray_pixels=bare_strays,
                 native_largest_component_share=float(sizes.max()/sizes.sum()),
                 native_detached_pixels=int(sizes.sum()-sizes.max()),
                 width_m_range=[min(v['width_m'] for v in leaf),max(v['width_m'] for v in leaf)],
                 longest_leaflet_nominal_m=max(v['nominal_length_m'] for v in leaf),
                 base_rgb_median=np.median(c[opaque],axis=0).tolist(),
                 roughness_percentiles=np.percentile(orm[:,x0:x1,1][opaque]/255,[0,5,50,95,100]).tolist(),
                 ao_percentiles=np.percentile(orm[:,x0:x1,0][opaque]/255,[0,5,50,95,100]).tolist(),
                 height_mm_range=[float(mm[:,x0:x1][opaque].min()),float(mm[:,x0:x1][opaque].max())],
                 mipmaps=[])
        arc_lengths = []
        for blade in leaf:
            cp=np.array(blade['control']); t=np.linspace(0,blade['end'],200)[:,None]
            points=(1-t)**3*cp[0]+3*(1-t)**2*t*cp[1]+3*(1-t)*t*t*cp[2]+t**3*cp[3]
            steps=np.diff(points,axis=0)/np.array([LAYOUT['pixels_per_metre_across'],LAYOUT['pixels_per_metre_along']])
            arc_lengths.append(float(np.linalg.norm(steps,axis=1).sum()))
        s['actual_planar_leaflet_length_m_percentiles']=np.percentile(arc_lengths,[0,50,90,100]).tolist()
        assert opaque[0].any() and opaque[-1].any()
        s['top_and_bottom_connected_to_midrib'] = True
        # Numeric outline: useful directly to a modeller fitting the card.
        outline = []
        for y in range(N):
            xx = np.flatnonzero(opaque[y])
            outline.append([y, int(x0+xx[0]) if len(xx) else None, int(x0+xx[-1]) if len(xx) else None])
        (CHECKS/f'slot_{slot["slot"]}_outline.json').write_text(json.dumps(outline,separators=(',',':'))+'\n')
        m['slots'].append(s)
    for factor in [1,2,4,8,16]:
        n=N//factor
        small_a = resize_data(alpha,n)
        small_rgb = resize_data(rgb,n)  # Explicit straight RGB, matching padded texture filtering.
        env = resize_data(envelope,n)
        for slot,s in zip(LAYOUT['slots'],m['slots']):
            x0=int(round(slot['x0']/factor)); x1=int(round(slot['x1']/factor))
            aa = small_a[:,x0:x1] >= .5
            env_area=float(env[:,x0:x1].sum())
            native = int((alpha[:,slot['x0']:slot['x1']]>=.5).sum())
            comp,num=ndi.label(aa, structure=np.ones((3,3)))
            sizes = np.bincount(comp.ravel())[1:]
            density=float(aa.sum()/env_area)
            retention=float(aa.sum()*factor*factor/native)
            s['mipmaps'].append(dict(factor=factor,height=n,cutout_pixels=int(aa.sum()),
                       envelope_area_pixels=env_area,coverage_of_frond_envelope=density,
                       fraction_of_slot=float(aa.mean()),native_area_retained=retention,
                       components=int(num),largest_component_share=float(sizes.max()/sizes.sum())))
            if factor == 8:
                assert density > .60, f'Slot {slot["slot"]} too sparse at 1/8'
                assert retention > .90, f'Slot {slot["slot"]} loses too much alpha at 1/8'
                assert sizes.max()/sizes.sum() > .97, 'Mip has broken into dust'
        if factor>1:
            for name,bg in [('grey',GREY),('sky',SKY)]:
                composite(small_rgb,small_a,bg,cut=True).save(CHECKS/f'mip_{factor:02d}_{name}.png')
    # Required visual artifacts.
    base_grey=composite(rgb,alpha,GREY,cut=True)
    height_view=composite(np.repeat((height*255)[...,None],3,-1),alpha,(20,24,22),cut=True)
    normal_view=composite(data['normal'],alpha,(20,24,22),cut=True)
    orm_view=composite(orm,alpha,(20,24,22),cut=True)
    sheet([('BASE / sRGB / alpha cut 0.5',base_grey),('HEIGHT / 0-10 mm',height_view),
           ('NORMAL / OpenGL / physical scale',normal_view),('ORM / linear / metalness zero',orm_view)],2,800).save(CHECKS/'layers.jpg',quality=94)
    guide=Image.open(ROOT/'guide/layout.png').convert('RGB')
    overlay=np.asarray(guide).astype(float)
    overlay=rgb*alpha[...,None]+overlay*(1-alpha[...,None])
    Image.fromarray(np.rint(overlay).astype(np.uint8)).save(CHECKS/'base_over_layout.png')
    mask=Image.fromarray(np.repeat(np.rint(alpha*255).astype(np.uint8)[...,None],3,-1))
    d=ImageDraw.Draw(mask)
    for slot in LAYOUT['slots']:
        for x in [slot['x0']+12,slot['x1']-13]:
            d.line((x,0,x,N-1),fill=(225,80,69),width=2)
    mask.save(CHECKS/'alpha_margins.png')
    lighting=[]
    for name,direction in [('upper_left',[-.78,.40,.47]),('lower_right',[.78,-.40,.47])]:
        im=light_preview(rgb,normal,orm,alpha,direction)
        im.save(CHECKS/f'lit_{name}.png')
        lighting.append((name.replace('_',' ').upper()+' / normal + ORM lighting',im))
    sheet(lighting,2,900).save(CHECKS/'relighting.jpg',quality=94)
    # Native-pixel mip ladder: no enlargement of the small images.
    ladder=Image.new('RGB',(2100,2120),(25,30,28)); d=ImageDraw.Draw(ladder)
    y=0
    for factor in [2,4,8,16]:
        n=N//factor
        d.text((14,y+8),f'1/{factor} - {n}px tall - ordinary box filter, alpha >= 0.5',font=font(19),fill=(229,234,223))
        for j,name in enumerate(['grey','sky']):
            im=Image.open(CHECKS/f'mip_{factor:02d}_{name}.png')
            ladder.paste(im,(14+j*1040,y+38))
        y+=n+52
    ladder.crop((0,0,2100,y)).save(CHECKS/'mip_ladder.jpg',quality=96)
    # Sample the material at 2x BEFORE applying the cutout. Nearest-enlarging an
    # already thresholded composite would hide the new alpha ramp completely.
    # Full-resolution detail, displayed twice native size to inspect creases.
    detail=Image.new('RGB',(3*700,3*500),(25,30,28)); d=ImageDraw.Draw(detail)
    for j,slot in enumerate(LAYOUT['slots']):
        cx=int(slot['midrib_x']); box=(cx-175,900,cx+175,1134)
        cr=filtered_crop(rgb,box,(700,468)); ca=filtered_crop(alpha,box,(700,468))
        cn=filtered_crop(normal,box,(700,468)); cn/=np.linalg.norm(cn,axis=-1,keepdims=True)
        co=filtered_crop(orm,box,(700,468))
        panels=[composite(cr,ca,GREY,cut=True)]
        panels += [light_preview(cr,cn,co,ca,l) for l in [[-.78,.40,.47],[.78,-.40,.47]]]
        for row,im in enumerate(panels):
            title=['Unlit pigment','Light upper left','Light lower right'][row]
            d.text((j*700+12,row*500+8),f'Slot {j}: {title}',font=font(18),fill=(229,234,223))
            detail.paste(im,(j*700,row*500+32))
    detail.save(CHECKS/'blade_detail.jpg',quality=96)
    # Source provenance review at native aspect; originals remain untouched.
    sources=Image.new('RGB',(2100,1050),(35,41,38)); d=ImageDraw.Draw(sources)
    for i,filename in enumerate(['leaflets_living_generated.png','leaflets_aging_generated.png','leaflets_fold_detail_generated.png']):
        src=Image.open(ROOT/'source'/filename)
        d.text((i*700+12,14),f'{filename} / {src.width} x {src.height}',font=font(17),fill=(235,238,228))
        bg=Image.new('RGBA',src.size,(*GREY,255)); bg.alpha_composite(src)
        bg.thumbnail((680,990),Image.Resampling.LANCZOS)
        sources.paste(bg.convert('RGB'),(i*700+(700-bg.width)//2,50))
    sources.save(CHECKS/'source_overview.jpg',quality=94)
    check_round2_detail(data, original, metadata, m, filtered_crop)
    m['passed']=True
    (CHECKS/'metrics.json').write_text(json.dumps(m,indent=2)+'\n')
    summary = {s['slot']:{'coverage':[round(v['coverage_of_frond_envelope'],3) for v in s['mipmaps']],
                          'retention':[round(v['native_area_retained'],3) for v in s['mipmaps']],
                          'detached_pixels':s['native_detached_pixels']} for s in m['slots']}
    print(json.dumps(summary,indent=2))
    print('Normal error:',m['normal_height_agreement'])
    print('Saved visual checks and metrics.json')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        CHECKS.mkdir(exist_ok=True)
        (CHECKS/'metrics.json').write_text(json.dumps({'passed':False,
            'error':type(error).__name__+': '+str(error)},indent=2)+'\n')
        raise
