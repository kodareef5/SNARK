"""Checks the saved face-group layers and records their reproducibility hashes."""
from pathlib import Path
import hashlib
import importlib.util
import json
import site
import sys
site.addsitedir(site.getusersitepackages())
sys.dont_write_bytecode=True
import numpy as np
from PIL import Image
from scipy.spatial import cKDTree
from scipy.ndimage import gaussian_filter1d,distance_transform_edt,label
from scipy.signal import find_peaks
ROOT=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('face_paint',ROOT/'paint.py')
paint=importlib.util.module_from_spec(spec);spec.loader.exec_module(paint)


def check():
    meta,piece,p,ids,regions,mm=paint.load_geometry()
    own=np.isin(piece,[ids[n] for n in paint.NAMES]);out=ROOT/'layers'
    maps={key:np.asarray(Image.open(out/('dodo_'+key+'.png'))) for key in ('base','height','rough','occlusion','regions')}
    b=maps['base'];assert b.shape==(2048,2048,4)
    assert np.array_equal(b[...,3]==255,own)
    assert np.all(b[...,3][~own]==0)
    for key,a in maps.items():
        assert a.shape[:2]==(2048,2048)
        assert not a[~own].any(),key+' leaks outside owned pieces'
    assert maps['height'].dtype==np.uint16
    painted=maps['regions'];red=own&(painted==[255,0,0]).all(-1)
    changed=own&np.any(painted!=regions,axis=-1)
    permitted=np.isin(piece,[ids['shell_face'],ids['pouch_out']])&(regions[...,1]==255)
    assert not np.any(changed&~permitted), 'Region changes escape the authorised margins'
    assert np.all(np.any(np.all(painted[changed,None,:]==np.array([[255,0,0],[0,0,0]]),axis=-1),axis=-1))
    skin=own&((painted==[0,255,0]).all(-1)|(painted==[0,255,255]).all(-1))
    separation=float(distance_transform_edt(~red)[skin].min())
    assert separation>=5, 'Fewer than four black texels between feathers and skin'
    rgb=paint.lin(b[...,:3]/255)
    info=json.loads((out/'layers.json').read_text())
    h=maps['height']/65535*info['height_mm']-info['zero_mm']
    stats=dict(passed=True,painted_texels=int(own.sum()),coverage_exact=True,regions_exact_outside_authorised_margins=True,outside_zero=True,pieces={})
    stats['neck_margin']=dict(red_texels=int(red.sum()),changed_region_texels=int(changed.sum()),
        minimum_red_to_skin_texel_centres=separation,black_buffer_at_least_four_texels=True)
    g=paint.margin.geometry(paint,piece,p,ids,regions,mm)
    new_red=red[own]
    face_extent=float(g['distance'][new_red&g['face']].max())
    pouch_extent=float(g['distance'][new_red&g['pouch']].max())
    assert 15<face_extent<=25 and pouch_extent<=8
    density=[]
    for lo,hi in [(0,3),(3,8),(8,13),(13,18),(18,23),(23,27)]:
        m=g['face']&(g['distance']>=lo)&(g['distance']<hi)
        density.append(dict(distance_mm=[lo,hi],feather_fraction=float(new_red[m].mean())))
    assert density[0]['feather_fraction']>.6 and density[4]['feather_fraction']<.2
    stats['neck_margin'].update(max_face_extent_mm=face_extent,max_pouch_extent_mm=pouch_extent,density=density)
    components,n=label(red&(piece==ids['shell_face']))
    attached=np.zeros_like(red)
    for k in range(1,n+1):
        m=(components==k)[own]
        if g['distance'][m].min()<1.1:attached|=components==k
    tree=cKDTree(p[attached]);tips=[]
    for k in range(1,n+1):
        m=components==k
        if np.any(m&attached):continue
        d=tree.query(p[m])[0];assert d.max()<=10, 'Lone feather is more than 1 cm from continuous plumage'
        tip_points=p[m];direction=paint.norm(g['D'][m[own]].mean(0))
        across=paint.norm(g['E'][m[own]].mean(0))
        length=float(np.ptp(tip_points@direction));width=float(np.ptp(tip_points@across))
        assert length/width>1.8, 'Remaining tip is round'
        tips.append(dict(distance_to_margin_mm=[float(d.min()),float(d.max())],length_mm=length,width_mm=width))
    stats['neck_margin']['isolated_tips']=tips
    assert p[own,0].min()>=0, 'Expected corrected left-side position maps'
    stats['positions_left_side_without_reflection']=True
    # Check exported relief against independent anatomical landmarks. The
    # central lower aperture must have a fleshy roll immediately alongside it;
    # the mouth crescent must start at the visible gape, not the jowl centre.
    pe=p[piece==ids['eye_l']];q=pe-paint.EYE
    edge=pe[(abs(paint.dot(q,paint.EYE_ACROSS))<8)&(paint.dot(q,paint.LOOK)>4)
            &(paint.dot(q,paint.LID_UP)>=0)&(paint.dot(q,paint.LID_UP)<.4)]
    face=piece==ids['shell_face'];pf=p[face];hf=h[face]
    rolls=pf[(hf>1)&(np.linalg.norm(pf-paint.EYE,axis=1)<28)]
    distance=cKDTree(rolls).query(edge)[0]
    assert len(edge)>100 and np.median(distance)<3 and np.percentile(distance,90)<4.2
    gape_distance=float(cKDTree(pf[hf>.6]).query(np.array([20.5,547,214.2]))[0])
    assert gape_distance<4, 'Mouth roll is detached from the gape'
    stats['fold_contacts']=dict(lower_lid_to_raised_roll_median_mm=float(np.median(distance)),
        lower_lid_to_raised_roll_p90_mm=float(np.percentile(distance,90)),
        aperture_samples=len(edge),gape_to_raised_roll_mm=gape_distance)
    for name in paint.NAMES:
        m=piece==ids[name]
        stat=dict(texels=int(m.sum()),texel_mm_p10_p50_p90=np.percentile(mm[m],[10,50,90]).tolist(),
             height_relative_mm=[float(h[m].min()),float(h[m].max())],
             roughness_mean=float(maps['rough'][m].mean()/255),occlusion_mean=float(maps['occlusion'][m].mean()/255))
        stats['pieces'][name]=stat
    stats['dyed_regions']={}
    for index,colour in [(0,[255,0,0]),(1,[0,255,0]),(3,[0,255,255])]:
        m=own&(painted==colour).all(-1)
        assert np.max(np.ptp(b[m,:3].astype(int),axis=1))==0
        mean=float(rgb[m].mean())
        # This pass explicitly matches the adjoining neck's local value. The
        # other accepted regions still retain their original 0.50 mean.
        assert abs(mean-.5)<(.025 if index==0 else .002),(index,mean)
        stats['dyed_regions'][str(index)]=dict(mean_linear=mean,neutral_channel_difference=0,texels=int(m.sum()))
    mouth=own&(regions==[0,0,0]).all(-1)
    assert mouth.any() and not np.all(b[mouth,0]==b[mouth,1])
    stats['mouth']=dict(texels=int(mouth.sum()),mean_srgb=b[mouth,:3].mean(0).tolist(),roughness=float(maps['rough'][mouth].mean()/255))
    # The hidden side is smooth; the long pleated side has substantial relief.
    inside=piece==ids['pouch_in'];outer=piece==ids['pouch_out']
    assert np.ptp(h[inside])<.001
    assert np.ptp(h[outer])>.35
    # Validate mirror continuity analytically: pouch coordinate is even in x.
    src,_=paint.sources();chart=paint.pouch_chart(p[outer]);y=np.linspace(456,545,120)
    sample=np.column_stack([np.zeros_like(y),y,np.interp(y,chart['y'],chart['z'])])
    a=sample.copy();a[:,0]=.02;c=sample.copy();c[:,0]=-.02
    left=paint.pouch_at(a,src,chart);right=paint.pouch_at(c,src,chart)
    # Width fades are inactive at the midline, so all samples must agree.
    err=max(float(np.max(np.abs(x-z))) for x,z in zip(left[:3],right[:3]));assert err<1e-6
    stats['pouch_midline_symmetric_error']=err
    # Measure pitch from delivered pixels, using the physical neck centreline.
    arc=np.linspace(6,chart['arc'][-1]-6,1800)
    yline=np.interp(arc,chart['arc'],chart['y'])
    queries=np.column_stack([np.full_like(arc,2.0),yline,np.interp(yline,chart['y'],chart['z'])])
    distance,nearest=cKDTree(p[outer]).query(queries,k=6)
    weights=1/np.maximum(distance,.03)**3
    section=(h[outer][nearest]*weights).sum(1)/weights.sum(1)
    section=gaussian_filter1d(section,1.0)
    peaks,_=find_peaks(section,distance=round(1.65/(arc[1]-arc[0])),prominence=.06)
    intervals=np.diff(arc[peaks])
    assert len(intervals)>30 and 1.85<float(np.median(intervals))<2.15
    stats['pouch_pitch_from_saved_height']=dict(median_mm=float(np.median(intervals)),
        p10_p90_mm=np.percentile(intervals,[10,90]).tolist(),intervals=len(intervals))
    stats['sha256']={f.name:hashlib.sha256(f.read_bytes()).hexdigest() for f in sorted(out.iterdir()) if f.is_file()}
    qa=ROOT/'checks';qa.mkdir(exist_ok=True)
    (qa/'metrics.json').write_text(json.dumps(stats,indent=2)+'\n')
    print(json.dumps(stats,indent=2))


if __name__=='__main__':check()
