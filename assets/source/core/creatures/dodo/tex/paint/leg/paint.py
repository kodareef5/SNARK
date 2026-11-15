#!/usr/bin/env python3
"""Paint the five leg islands from the accepted study's three immutable originals.

Run from any directory: python3 -B tex/paint/leg/paint.py
Pillow, NumPy, SciPy. No Blender, network, image generation or study writes.
Coordinates and dimensions below are the rest-form stations in model.py, metres.
"""
from pathlib import Path
import hashlib
import importlib.util
import json
import sys

sys.dont_write_bytecode = True
import numpy as np
from PIL import Image, PngImagePlugin
from scipy.ndimage import gaussian_filter, map_coordinates
from scipy.interpolate import CubicHermiteSpline

HERE = Path(__file__).resolve().parent
PAINT = HERE.parent
DODO = PAINT.parent.parent
STUDY = DODO/'tex/studies/leg'
LAYERS = HERE/'layers'
NAMES = ['leg_l', 'toe4_+188', 'toe4_+30', 'toe4_+4', 'toe4_-24']
HEIGHT_MM = .8
SHANK_SCALE = 1.40  # nominal 7–10 mm front faces become approximately 10–14 mm
FRONT_OUT = np.deg2rad(18.)
LEG = np.array([
    [.0635,.182,.026,.0245,.0265], [.0618,.152,.014,.0225,.0245],
    [.0595,.122,.004,.0198,.0222], [.0580,.095,.0025,.0182,.0206],
    [.0573,.065,.003,.0178,.0200], [.0568,.040,.0045,.0186,.0206],
    [.0563,.024,.007,.0205,.0225], [.0560,.012,.009,.0195,.0215],
])
BALL = np.array([.0565,.011,.010])
TOES = {
    'toe4_+188': (188., .060, .0094, .13),
    'toe4_+30': (30., .084, .0100, .42),
    'toe4_+4': (4., .098, .0105, .71),
    'toe4_-24': (-24., .088, .0100, .94),
}


def smooth(a,b,x):
    t=np.clip((x-a)/(b-a),0,1)
    return t*t*(3-2*t)


def lin(a):
    return np.where(a<=.04045,a/12.92,((a+.055)/1.055)**2.4)


def srgb(a):
    a=np.clip(a,0,1)
    return np.where(a<=.0031308,a*12.92,1.055*a**(1/2.4)-.055)


def load_bakes():
    meta=json.loads((PAINT/'pieces.json').read_text())
    ids=np.asarray(Image.open(PAINT/'pieces.png'))[:,:,0]
    lo=np.array(meta['position_box']['min'],np.float32)
    span=np.array(meta['position_box']['max'],np.float32)-lo
    p=np.stack([np.asarray(Image.open(PAINT/f'position_{a}.png'),np.float32) for a in 'xyz'],-1)
    p=p/65535*span+lo
    # The corrected position bake and object normals both describe the left
    # side. Decode its current bounds directly, without reflecting either map.
    regions=np.asarray(Image.open(DODO/'ref/bakes/dodo_regions.png').convert('RGB'))
    mm=np.asarray(Image.open(PAINT/'texel_mm.png'),np.float32)/1000
    return meta,ids,p,regions,mm


def study_fields():
    spec=importlib.util.spec_from_file_location('accepted_leg_study',STUDY/'build.py')
    study=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(study)
    fields={}
    for name in ['shank','toe','claw']:
        c=study.CONFIG[name].copy()
        base,height,rough,_=study.build_claw(c) if name=='claw' else study.build_scales(name,c)
        height=np.rint(height*65535).astype(np.float32)/65535
        ao=study.ao_from_height(height,c)
        # Filter the aligned channels together for the coarser bird texels.
        f=np.concatenate([lin(base), (height*c['height_mm'])[:,:,None],
                          rough[:,:,None],ao[:,:,None]],axis=2).astype(np.float32)
        sigma={'shank':2.0,'toe':2.2,'claw':3.0}[name]
        fields[name]=gaussian_filter(f,(sigma,sigma,0),mode=('reflect' if name=='claw' else 'wrap','wrap','nearest'))
        print(f'Reconstructed accepted {name} from original',flush=True)
    # A reusable planar sole pad made from the accepted small rear scales.
    # Its periodic boundary correction is the accepted study's own method.
    n=fields['shank'].shape[0]; size=round(n*.16)
    crop=fields['shank'][round(n*.36):round(n*.36)+size,round(n*.01):round(n*.01)+size]
    pad=np.stack([study.periodic_source(crop[:,:,k]) for k in range(6)],axis=2)
    pad[:, :, 3]=.27+.70*(pad[:,:,3]-.27)
    pad[:, :, 4]=np.clip(.75+.5*(pad[:,:,4]-.60),.71,.84)
    pad[:, :, 5]=np.clip(pad[:,:,5],.85,1)
    fields['pads']=pad
    return fields


def sample(field,u,v,vertical_wrap=True):
    n=field.shape[0]
    yy=(v%1 if vertical_wrap else np.clip(v,0,1))*(n-1)
    xx=(u%1)*n
    return np.stack([map_coordinates(field[:,:,k],[yy,xx],order=1,mode='grid-wrap',prefilter=False)
                     for k in range(field.shape[2])],axis=-1)


def leg_coordinates(p):
    centres=LEG[:,:3]
    delta=np.diff(centres,axis=0)
    length=np.linalg.norm(delta,axis=1)
    cumulative=np.r_[0,np.cumsum(length)]
    # Closest point on the sloping centreline. Angle uses the local ring frame,
    # not the atlas and not the object's global vertical axis.
    rel=p[:,None,:]-centres[None,:-1,:]
    t=np.clip(np.sum(rel*delta[None,:,:],axis=2)/length[None,:]**2,0,1)
    q=centres[None,:-1,:]+t[:,:,None]*delta[None,:,:]
    nearest=np.argmin(np.sum((p[:,None,:]-q)**2,axis=2),axis=1)
    row=np.arange(len(p)); f=t[row,nearest]; centre=q[row,nearest]
    axis=-delta[nearest]/length[nearest,None]
    a=np.cross(axis,np.array([0.,0.,1.])); a/=np.linalg.norm(a,axis=1)[:,None]
    b=np.cross(a,axis)
    widths=LEG[nearest,3:]*(1-f[:,None])+LEG[nearest+1,3:]*f[:,None]
    offset=p-centre
    angle=np.arctan2(np.sum(offset*a,axis=1)/widths[:,0],
                     np.sum(offset*b,axis=1)/widths[:,1])-FRONT_OUT
    angle=(angle+np.pi)%(2*np.pi)-np.pi
    s=cumulative[nearest]+f*length[nearest]
    ankle=smooth(.021,.044,centre[:,1])
    scale=.72+(SHANK_SCALE-.72)*ankle
    radius=np.sqrt(np.prod(widths,axis=1))
    # Enlarged front faces; accelerate through the medium side plates and rear
    # pebble field. The back always meets at the same periodic source edge.
    a90=np.clip(radius*(np.pi/2)/(.125*scale),.13,.32)
    knots=np.array([0,np.pi/2,2*np.pi/3,5*np.pi/6,np.pi])
    # Interpolate each variable front width against two monotone basis maps.
    def angular_map(edge):
        rest=.5-edge
        values=[0,edge,edge+.45*rest,edge+.80*rest,.5]
        slopes=[edge/(np.pi/2),edge/(np.pi/2),.80*rest/(np.pi/3),
                .55*rest/(np.pi/3),.20*rest/(np.pi/6)]
        return CubicHermiteSpline(knots,values,slopes)(np.abs(angle))
    low=angular_map(.13)
    high=angular_map(.32)
    off=low+(high-low)*(a90-.13)/.19
    u=.5+np.sign(angle)*off
    grid=np.linspace(0,cumulative[-1],1025)
    gy=np.interp(grid,cumulative,centres[:,1])
    gs=.72+(SHANK_SCALE-.72)*smooth(.021,.044,gy)
    rate=1/(.125*gs)
    integrated=np.r_[0,np.cumsum((rate[:-1]+rate[1:])*.5*np.diff(grid))]
    v=.17+np.interp(s,grid,integrated)
    # Avoid a pole in the hidden bottom cap: continuous shallow planar pads.
    return u,v,centre[:,1],angle


def leg_material(p,fields):
    u,v,y,angle=leg_coordinates(p)
    result=sample(fields['shank'],u,v)
    sole=1-smooth(.009,.016,p[:,1])
    pad=sole_material(p,fields)
    result=result*(1-sole[:,None])+pad*sole[:,None]
    # Keep the material quiet where it disappears into the trouser cards.
    calm=smooth(.165,.184,p[:,1])
    neutral=np.array([.5,.5,.5,.27,.64,1.])
    result=result*(1-calm[:,None])+neutral*calm[:,None]
    return result


def sole_material(p,fields):
    return sample(fields['pads'],.24+(p[:,0]-BALL[0])/.024,
                  .62+(p[:,2]-BALL[2])/.024)


def toe_coordinates(p,name):
    heading,length,r0,phase=TOES[name]
    rad=np.deg2rad(heading)
    direction=np.array([np.sin(rad),0.,np.cos(rad)])
    across=np.cross(direction,[0.,1.,0.])
    t=np.sum((p-BALL)*direction,axis=1)/length
    stations=np.array([0.,.30,.58,.82,.95,1.08,1.20])
    radii=r0*np.array([1.,.90,.80,.62,.48,.24,.0])+np.array([0,.0012,.001,0,0,0,0])
    cy=np.r_[radii[:4]*.62+.0012+.004*np.maximum(0,.3-stations[:4]),.0058,.0046,.0008]
    centre=BALL[None,:]+t[:,None]*length*direction
    centre[:,1]=np.interp(t,stations,cy)
    side=np.sum((p-centre)*across,axis=1)
    up=p[:,1]-centre[:,1]
    vertical_scale=np.where(up>=0,.85,.6)
    angle=np.arctan2(side,up/vertical_scale)
    radius=np.interp(t,stations,radii)
    return t,angle,radius,length,phase


def toe_material(p,name,black,fields):
    t,angle,radius,length,phase=toe_coordinates(p,name)
    # Two-ish large faces across the dorsal arc; smaller drawing round the sides.
    off=CubicHermiteSpline([0,np.pi/3,np.pi/2,5*np.pi/6,np.pi],
                          [0,.16,.29,.46,.5],[.16/(np.pi/3),.16/(np.pi/3),.22,.11,.076])(np.abs(angle))
    u=.5+np.sign(angle)*off
    v=t*length/.060+phase
    result=sample(fields['toe'],u,v)
    side=smooth(.95,1.65,np.abs(angle))*(1-smooth(2.20,2.65,np.abs(angle)))
    pebbles=sample(fields['shank'],.08+(np.abs(angle)-1.6)*radius/.125,
                   t*length/.125+phase)
    result=result*(1-side[:,None])+pebbles*side[:,None]
    # Narrow intrinsic pigment creases at actual model knuckles; little relief.
    joint=sum(np.exp(-((t-k)*length/.00042)**2) for k in [.30,.58])
    joint*=1-smooth(1.5,2.5,np.abs(angle))
    result[:,:3]*=(1-.065*joint[:,None])
    result[:,3]-=.016*joint
    result[:,4]+=.025*joint
    # The same 3-D ankle drawing on every root, continuous at shared positions.
    away=np.linalg.norm(p-BALL,axis=1)
    root=1-smooth(.020,.032,away)
    shared=leg_material(p,fields)
    result=result*(1-root[:,None])+shared*root[:,None]
    sole=smooth(1.6,2.5,np.abs(angle))
    result=result*(1-sole[:,None])+sole_material(p,fields)*sole[:,None]
    collar=smooth(.91,.95,t)
    result[:,3]=result[:,3]*(1-collar)+.27*collar
    # Region boundaries, including the start of the claw at station .95, come
    # exclusively from the bake. Full colour run follows the remaining length.
    if black.any():
        claw_v=np.clip((t[black]-.95)/.25,0,1)
        claw_u=.5+angle[black]/(2*np.pi)
        horn=sample(fields['claw'],claw_u,claw_v,False)
        horn[:,3]+=.23  # common relief datum prevents an artificial cut at the root
        result[black]=horn
    return result


def save(name,a,bits=8,srgb_image=False):
    meta=PngImagePlugin.PngInfo()
    meta.add(b'gAMA',(45455 if srgb_image else 100000).to_bytes(4,'big'))
    if srgb_image: meta.add(b'sRGB',b'\0')
    code=np.rint(np.clip(a,0,1)*(65535 if bits==16 else 255)).astype(np.uint16 if bits==16 else np.uint8)
    Image.fromarray(code).save(LAYERS/name,pnginfo=meta)


def main():
    LAYERS.mkdir(parents=True,exist_ok=True)
    meta,ids,p,regions,mm=load_bakes()
    numbers={entry['name']:entry['number'] for entry in meta['pieces']}
    own=np.isin(ids,[numbers[name] for name in NAMES])
    fields=study_fields()
    values=np.zeros((*ids.shape,6),np.float32)
    for name in NAMES:
        mask=ids==numbers[name]
        black=(regions[mask]==0).all(axis=1)
        values[mask]=leg_material(p[mask],fields) if name=='leg_l' else toe_material(p[mask],name,black,fields)
        print(f'{name}: {mask.sum()} texels painted',flush=True)
    dyed=own & (regions[:,:,1]==255) & (regions[:,:,2]==255)
    # Normalize after placement, over the actual visible UV texels of the region.
    before=float(values[dyed,:3].mean())
    values[dyed,:3]*=.5/before
    assert np.isfinite(values[own]).all(), 'Nonfinite material value'
    rgba=np.zeros((*ids.shape,4),np.float32)
    rgba[own,:3]=srgb(values[own,:3]); rgba[own,3]=1
    save('dodo_base.png',rgba,srgb_image=True)
    save('dodo_height.png',values[:,:,3]/HEIGHT_MM,bits=16)
    save('dodo_rough.png',values[:,:,4])
    save('dodo_occlusion.png',values[:,:,5])
    save('dodo_regions.png',np.where(own[:,:,None],regions,0)/255)
    inputs=[STUDY/'build.py',STUDY/'source/r3_shank_generated.png',
            STUDY/'source/r3_toe_generated.png',STUDY/'source/r2_claw_generated.png',
            PAINT/'pieces.json',PAINT/'pieces.png',PAINT/'texel_mm.png',*(PAINT/f'position_{a}.png' for a in 'xyz'),
            DODO/'ref/bakes/dodo_regions.png']
    info=dict(group='leg',height_mm=HEIGHT_MM,pieces=NAMES,shank_scale=SHANK_SCALE,
              shank_front_axis_degrees_out=18,dyed_linear_mean_before_normalization=before,
              source_inputs=[dict(path=str(path.relative_to(DODO)),sha256=hashlib.sha256(path.read_bytes()).hexdigest()) for path in inputs],
              mapping='Direct left-side position bake; curved shank centreline and toe axes; shared ankle material at roots.',
              claw='Baked black texels only; base station .95 to tip 1.20, dark-to-worn accepted horn.')
    (LAYERS/'layers.json').write_text(json.dumps(info,indent=2)+'\n')
    print(f'Complete: {own.sum()} owned texels; cyan mean corrected from {before:.6f} to 0.50',flush=True)


if __name__=='__main__':
    main()
