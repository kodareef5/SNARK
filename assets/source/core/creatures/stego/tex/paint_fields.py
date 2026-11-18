"""Paint original continuous anatomical fields into the final unwrapped UVs.

No photographs, library textures, or ARK pixels are sampled. All color,
scale relief, horn growth and damage originate in world-space procedural fields.
"""
from pathlib import Path
import numpy as np
from PIL import Image
from paint import OUT, save, srgb, linear, noise, saddle

COLORS=np.array([[35,59,45],[67,91,57],[156,150,105],[134,82,46],[73,48,36],[153,138,92]],dtype=np.float32)/255

def smoothstep(a,b,x):
    q=np.clip((x-a)/(b-a),0,1)
    return q*q*(3-2*q)

def hash3(x,y,z,seed=0):
    return np.mod(np.sin(x*127.1+y*311.7+z*74.7+seed*93.1)*43758.5453,1)

def noise3(p,f):
    q=p*f;i=np.floor(q);t=q-i;t=t*t*(3-2*t)
    out=np.zeros(p.shape[:-1],dtype=np.float32)
    for a in [0,1]:
        for b in [0,1]:
            for c in [0,1]:
                weight=(t[...,0]if a else 1-t[...,0])*(t[...,1]if b else 1-t[...,1])*(t[...,2]if c else 1-t[...,2])
                out+=weight*hash3(i[...,0]+a,i[...,1]+b,i[...,2]+c)
    return out

def cells(p,diameter):
    q=p/diameter[...,None];i=np.floor(q)
    first=np.full(q.shape[:-1],1e6,dtype=np.float32);second=first.copy();mark=np.zeros_like(first)
    for x in [-1,0,1]:
        for y in [-1,0,1]:
            for z in [-1,0,1]:
                at=i+np.array([x,y,z],dtype=np.float32)
                seed=np.stack([hash3(at[...,0],at[...,1],at[...,2],k)for k in [1,2,3]],-1)
                d=np.sum((q-(at+.09+.82*seed))**2,axis=-1)
                closer=d<first;second=np.where(closer,first,np.minimum(second,d));first=np.minimum(first,d)
                mark=np.where(closer,hash3(at[...,0],at[...,1],at[...,2],4),mark)
    return np.sqrt(first),np.sqrt(second),mark

def dilate(fields,valid,passes=16):
    values=fields.copy();mask=valid.copy()
    for _ in range(passes):
        old=mask.copy()
        for dy,dx in [(-1,0),(1,0),(0,-1),(0,1)]:
            source=np.roll(old,(dy,dx),(0,1));source[0 if dy>0 else -1,:]=False if dy else source[0 if dy>0 else -1,:]
            if dx:source[:,0 if dx>0 else -1]=False
            take=~mask&source
            values[take]=np.roll(values,(dy,dx),(0,1))[take];mask[take]=True
    return values,mask

def normal_from_height(fields,height,valid):
    p=fields[...,:3];n=fields[...,3:6];t=fields[...,6:9]
    n/=np.maximum(1e-8,np.linalg.norm(n,axis=-1,keepdims=True));t-=n*np.sum(t*n,axis=-1,keepdims=True);t/=np.maximum(1e-8,np.linalg.norm(t,axis=-1,keepdims=True))
    b=np.cross(n,t)*np.sign(fields[...,9,None])
    py,px=np.gradient(p,axis=(0,1));hy,hx=np.gradient(height)
    # Rows go down the image; the OpenGL tangent-space green axis points up.
    pu=px;pv=-py;hu=hx;hv=-hy
    a=np.sum(pu*t,-1);bb=np.sum(pu*b,-1);c=np.sum(pv*t,-1);d=np.sum(pv*b,-1);det=a*d-bb*c
    good=valid&(np.abs(det)>1e-10)
    gu=np.zeros_like(height);gv=np.zeros_like(height)
    gu[good]=(hu[good]*d[good]-hv[good]*bb[good])/det[good]
    gv[good]=(hv[good]*a[good]-hu[good]*c[good])/det[good]
    normal=np.stack([-gu,-gv,np.ones_like(gu)],-1);normal/=np.linalg.norm(normal,axis=-1,keepdims=True)
    return normal

def hoof_walls(points, base, weights, roughness, height):
    foot=(points[...,1]<.21)&(np.abs(points[...,0])>.38)
    x,y,z=points[foot].T
    if not len(x):return
    x=np.abs(x)
    wall=np.zeros_like(x);coronet=np.zeros_like(x)
    # Each dorsal crescent starts inside its phalanx and reaches the bearing
    # edge. The two medial manus nails and the three pes nails carry different
    # splays and wear patterns. Positions here are in packed model metres.
    digits=[(.565,1.411,.085,-.20),(.715,1.450,.088,.025),
            (.61,-.313,.094,-.16),(.77,-.266,.096,0),(.93,-.321,.094,.18)]
    fiber=noise3(np.stack([x*95,y*11,z*33],-1),1)
    for cx,cz,width,splay in digits:
        along=z-cz
        across=(x-cx-splay*along)/width
        edge=1-smoothstep(.81,1.04,np.abs(across))
        start=-.027+.045*across**2+.003*(fiber-.5)
        distance=along-start
        roof=.124-.182*along-.016*across**2
        exposed=edge*(1-smoothstep(roof-.006,roof+.010,y))
        wall=np.maximum(wall,exposed*smoothstep(-.009,.010,distance))
        coronet=np.maximum(coronet,exposed*np.exp(-((distance+.006)/.010)**2))
    bearing=1-smoothstep(.014,.064,y+.004*(fiber-.5))
    variation=.50*fiber+.50*noise3(points[foot],19)
    pigment=np.stack([.25+.095*bearing+.060*variation,.215+.086*bearing+.049*variation,.153+.070*bearing+.039*variation],-1)
    # Blend at the visible dyed pad first; undo that dye for the partial
    # coverage texels so changing a region keeps the cuticle continuous.
    source=weights[foot]
    tint=source@linear(COLORS)/.5+(1-source.sum(-1))[:,None]
    wanted=base[foot]*tint*(1-wall[:,None])+linear(pigment)*wall[:,None]
    remaining=source*(1-wall[:,None]);weights[foot]=remaining
    tint=remaining@linear(COLORS)/.5+(1-remaining.sum(-1))[:,None]
    base[foot]=wanted/np.maximum(.001,tint)
    roughness[foot]=roughness[foot]*(1-wall)+(.64+.085*bearing+.04*variation)*wall
    height[foot]=height[foot]*(1-wall)+.00065*(fiber-.5)*wall+.0018*coronet


def spike_sheath(points, normals):
    """Flesh, darker young keratin and polished distal horn on each tail spike."""
    x, y, z = points.T
    distance = np.abs(x)
    rear = (z + .61 * distance < -5.37).astype(np.float32)
    phase = 1.3 * rear + .7 * np.sign(x)
    angle = np.arctan2(normals[:, 1], normals[:, 2])
    grain = noise3(points, 39)
    broad = noise3(points, 8)
    fibre = .5 + .5 * np.sin(13 * angle + 5 * distance + phase + 1.8 * (broad - .5))
    seam = .220 + .046 * np.sin(3 * angle + phase) + .026 * np.sin(angle - phase)
    seam += .025 * (grain - .5) - .018 * rear
    rooted = 1 - smoothstep(seam - .055, seam + .085, distance)
    mature = smoothstep(seam + .045, seam + .205, distance + .031 * fibre)
    growing = (1 - rooted) * (1 - mature) * (.57 + .37 * fibre)
    weights = np.zeros((len(x), 6), dtype=np.float32)
    weights[:, 0] = rooted * (.38 + .24 * (normals[:, 1] + 1) * .5)
    weights[:, 1] = rooted - weights[:, 0]
    weights[:, 4] = growing
    weights[:, 5] = 1 - rooted - growing
    weather = smoothstep(.46, .76, distance) * (.35 + .65 * fibre)
    grey = .47 + .11 * (broad - .5) + .11 * (grain - .5) * rooted
    grey += (1 - rooted) * (.113 * (fibre - .5) + .074 * weather)
    base = np.repeat(grey[:, None], 3, axis=1)
    rough = .60 + .11 * rooted + .047 * (grain - .5) - .10 * weather
    return base, weights, rough, .97 - .030 * rooted


def flank_pattern(p, n, grey, dorsal, underside, mark):
    """Descending dorsal bars bend over the scapula, ribs and iliac crest."""
    x,y,z=p[...,0],p[...,1],p[...,2]
    station=[-4.8,-3.8,-3.0,-2.4,-2.,-1.65,-1.30,-.82,-.30,.18,.65,.96,1.22,1.48,1.70,1.88,2.08,2.32,2.50]
    top=np.interp(z,station,[1.40,1.39,1.59,1.87,2.16,2.44,2.80,3.00,2.81,2.61,2.39,2.23,2.22,2.01,1.75,1.67,1.63,1.52,1.46])
    depth=np.interp(z,station,[.16,.28,.44,.61,.81,1.02,1.65,2.03,2.05,1.92,1.66,1.46,1.29,1.01,.71,.56,.47,.38,.35])
    h=(top-y)/depth
    side=smoothstep(.05,.64,np.abs(n[...,0])+.22*(1-n[...,1]))
    area=side*smoothstep(-.03,.20,h)*(1-smoothstep(.65,.88,h))
    area*=smoothstep(-4.55,-3.83,z)*(1-smoothstep(2.31,2.56,z))
    # Every bar has a different root, descent, obliquity and taper. The
    # outer shoulder bifurcates and the caudal marks bend toward the tail.
    bars=np.zeros_like(y);light_margin=np.zeros_like(y)
    dark=np.zeros_like(y)
    grain=noise3(p,8.4);wash=noise3(p,2.85)
    offset=.033*(grain-.5)+.068*(wash-.5)
    offset+=np.sign(x)*(.020*np.sin(z*3.2)+.010*np.sin(z*8.6))
    for root, end, lean, width, curve, fork in [
        (-3.49,.56,.15,.081,-.12,0),(-2.98,.75,.29,.115,.17,0),
        (-2.43,.58,.22,.133,.12,0),(-1.96,.74,.31,.152,.15,.36),
        (-1.40,.76,.42,.164,.21,0),(-.91,.63,.23,.143,.19,.27),
        (-.40,.78,-.08,.170,.16,0),(.045,.58,-.23,.122,.19,.39),
        (.63,.80,-.57,.176,-.23,.39),(1.115,.65,-.36,.104,-.20,0),
        (1.44,.54,-.28,.082,-.10,.22),(1.78,.66,-.18,.067,-.07,0),
        (2.00,.59,-.11,.058,-.06,0),(2.21,.55,-.06,.048,-.04,0)]:
        fall=np.clip(h,0,1)
        center=root+lean*fall+curve*fall*fall+offset
        taper=width*(1-.72*smoothstep(.04,end,fall))
        taper=np.maximum(.014,taper)
        length=1-smoothstep(end-.17,end+.028,fall+.12*(wash-.5))
        # The scapular fork broadens across the muscle, while its neighbour
        # dissolves into separate pigment islands halfway down the rib wall.
        strength=.77+.16*np.cos(root*4.3+.45)
        if .01<root<.15:
            strength=.61
            length*=1-.68*np.exp(-((fall-.37-.045*(wash-.5))/.068)**2)
        if .56<root<.75:
            taper*=1+.30*np.exp(-((fall-.31)/.13)**2)
            strength=.94
        elif 1<root<1.2:
            strength=.62
            length*=.87+.13*grain
        elif 1.3<root<1.53:
            strength=.70
        cross=(z-center)/taper
        main=(1-smoothstep(.42,1.40,np.abs(cross)))*length
        if fork:
            branch=(z-center+fork*np.maximum(0,fall-.22))/(.48*taper)
            arm=(1-smoothstep(.22,1.35,np.abs(branch)))*smoothstep(.17,.36,fall)*length
            main=np.maximum(main,arm*.77)
        light=np.exp(-((cross-1.30)/.59)**2)*length
        # The last scales in a broken edge retain small islands of pigment.
        fleck=smoothstep(.43,.61,.55*grain+.28*wash+.17*mark)
        main*=strength*(1-smoothstep(.25,.65,fall)*.27*(1-fleck))
        bars=np.maximum(bars,main)
        light_margin=np.maximum(light_margin,light)
        dark=np.maximum(dark,strength*np.exp(-(cross/.58)**2)*length)
    # The lighter border is partial and carries the countershade region.
    # The mid-flank retains quieter hide between the irregular marks.
    border=light_margin*smoothstep(.22,.66,wash+.13*(mark-.5))
    dorsal[:]=dorsal*(1-area)+area*np.maximum(.31*dorsal,.91*bars+.07*wash)
    underside[:]=np.clip(underside+area*(.23*border+.12*(1-bars)*smoothstep(.31,.66,h)),0,.89)
    grey+=area*(.085*(1-bars)-.155*dark+.058*border+.052*(mark-.5)*bars)
    # One longitudinal line leaves the eye plane and travels under the small
    # neck bars. It widens and fades as the scapular pattern takes over.
    seam_center=np.interp(z,[1.32,1.54,1.82,2.04,2.27,2.53],[1.63,1.53,1.40,1.39,1.36,1.33])
    throat=np.exp(-((y-seam_center-.011*(grain-.5))/(.030+.025*(1-smoothstep(1.54,2.49,z))))**2)
    throat*=smoothstep(1.22,1.66,z)*(1-smoothstep(2.37,2.57,z))*side
    dorsal[:]=np.maximum(dorsal,.83*throat)
    grey-=.08*throat


def paint(folder,name):
    data=np.load(folder/(name+'-fields.npz'));fields,valid=dilate(data['fields'],data['valid'])
    p=fields[...,:3];n=fields[...,3:6];u=fields[...,10];v=fields[...,11]
    weights=np.zeros((*valid.shape,6),dtype=np.float32)
    broad=noise3(p,2.1);fine=noise3(p,170)
    if name=='stego_skin':
        # Shoulder armor scales are broad; face and flexing joints are fine.
        face=smoothstep(1.85,2.55,p[...,2]);limb=1-smoothstep(.45,1.35,p[...,1])
        shoulder=np.exp(-((p[...,2]-.6)/.7)**2)*smoothstep(1.1,1.8,p[...,1])
        # Compress the scale spacing across joint creases. Distort the sampling
        # coordinates continuously so cell boundaries do not follow a square grid.
        x,y,z=p[...,0],p[...,1],p[...,2]
        warped=p.copy()
        warped[...,0]+=.008*np.sin(9*z+4*y)+.003*np.sin(18*y-7*x)
        warped[...,1]+=.009*np.sin(7*x+5*z)+.004*np.sin(15*z+8*y)
        warped[...,2]+=.008*np.sin(6*y-4*x)+.004*np.sin(13*x+10*y)
        first,second,mark=cells(warped,np.float32(.034))
        fsmall,ssmall,msmall=cells(warped,np.float32(.017))
        flarge,slarge,mlarge=cells(warped,np.float32(.049))
        fdetail,sdetail,mdetail=cells(warped,np.float32(.009))
        elbow=np.exp(-((z-.8)/.39)**2-((y-.80)/.36)**2)
        knee=np.exp(-((z+.44)/.37)**2-((y-1.05)/.40)**2)
        throat_field=np.exp(-((z-1.93)/.47)**2-((y-1.30)/.36)**2)
        cheek=np.exp(-((z-2.44)/.27)**4-((y-1.28)/.22)**4)
        fine_skin=np.maximum.reduce([face*.91,limb*.76,throat_field*.92,elbow*.97,knee*.97,cheek*.90])
        armor=shoulder*.49*(1-fine_skin)*smoothstep(.31,.69,noise3(p,3.1))
        orbital=np.exp(-((z-2.523)/.105)**4-((y-1.326)/.061)**4)
        lip=np.exp(-((z-2.62)/.28)**4-((y-1.115)/.037)**4)
        supple=np.maximum(orbital,lip)*.92
        broad_skin=(1-fine_skin-armor)*(1-supple)
        fine_skin*=1-supple
        armor*=1-supple
        edge=(smoothstep(.006,.20,second-first)*broad_skin
              +smoothstep(.006,.20,ssmall-fsmall)*fine_skin
              +smoothstep(.006,.20,slarge-flarge)*armor
              +smoothstep(.006,.20,sdetail-fdetail)*supple)
        dome=(np.maximum(0,1-first)*broad_skin+np.maximum(0,1-fsmall)*fine_skin
              +np.maximum(0,1-flarge)*armor+np.maximum(0,1-fdetail)*supple)
        mark=mark*broad_skin+msmall*fine_skin+mlarge*armor+mdetail*supple
        relief=(.0028+.0017*armor)*(1-.42*face)*(1-.51*supple)
        height=relief*(.57*edge+.43*dome)+.00007*(fine-.5)
        # Directional folds are restrained relief over the authored neck form.
        throat=np.exp(-((p[...,2]-1.95)/.48)**4)*np.maximum(np.clip(-n[...,1]+.2,0,1),np.abs(n[...,0])*.65)
        rawz=1.5+(p[...,2]-1.5)/.67
        for base,amplitude,width in [(1.10,.0020,.015),(1.205,.0027,.018),(1.315,.0017,.014)]:
            tension=base+.065*(rawz-1.5)+.018*np.sin(rawz*3+base*4)
            height-=amplitude*np.exp(-((p[...,1]-tension-.035)/width)**2)*throat
        grey=.47+.12*(mark-.5)+.30*(broad-.5)+.16*(noise3(p,.78)-.5)-.040*(1-edge)
        # A warmer cheek plane and a lighter, narrow inferior lid separate the
        # eye from the socket. The upper lid remains shaded by the bony brow.
        lower_lid=np.exp(-((z-2.525)/.065)**2-((y-1.292-.12*(z-2.525))/.021)**2)
        side_skin=smoothstep(.13,.19,np.abs(x))
        grey+=side_skin*(.074*lower_lid+.031*cheek*(.6+.4*broad))
        center=np.interp(p[...,2],[-6,-2,-1,.4,1.4,2.5,3],[1.3,1.5,1.9,1.7,1.45,1.3,1.2])
        dorsal=smoothstep(.0,.65,p[...,1]-center)
        pigment=noise3(p,.85)*.64+noise3(p,3.4)*.36
        mottling=smoothstep(.38,.63,pigment)*smoothstep(-.5,.20,p[...,1]-center)
        dorsal=np.maximum(dorsal*.75,mottling*.80)
        # A dark cranial roof breaks the broad cheek plane into orbital and
        # nasal regions; the under-jaw stays warm and lighter. This uses the
        # existing dye regions and follows anatomy, not a pasted facial stripe.
        cranial=face*smoothstep(1.22,1.41,p[...,1]+.025*(pigment-.5))*.68
        dorsal=np.maximum(dorsal,cranial)
        underside=(1-smoothstep(-.5,.05,p[...,1]-center))*.76
        underside*=1-.6*limb
        flank_pattern(p,n,grey,dorsal,underside,mark)
        weights[...,0]=dorsal*(1-underside);weights[...,2]=underside;weights[...,1]=1-weights[...,0]-weights[...,2]
        rough=.57+.20*(1-edge)+.07*broad;occ=.96-.10*(1-edge)
        base=np.repeat(np.clip(grey,.1,.8)[...,None],3,-1)
        # Both nostrils are carved into the same live skin. Their recessed dark
        # openings retain a thin dry rim; there is no separate glossy sphere.
        nasal=((p[...,2]-2.7395)/.039)**2+((p[...,1]-1.255-.20*(p[...,2]-2.7395))/.019)**2
        opening=(1-smoothstep(.75,1.0,nasal))*smoothstep(.05,.07,np.abs(p[...,0]))
        opening*=1-smoothstep(.104,.140,np.abs(p[...,0]))
        living=np.einsum('...k,kc->...c',weights,linear(COLORS))/.5+(1-weights.sum(-1))[...,None]
        wanted=base*living*(1-opening[...,None])+linear(np.array([.055,.047,.034]))*opening[...,None]
        weights*=1-opening[...,None]
        remaining=np.einsum('...k,kc->...c',weights,linear(COLORS))/.5+(1-weights.sum(-1))[...,None]
        base=wanted/np.maximum(.001,remaining)
        rough=rough*(1-opening)+.72*opening;height*=1-opening
        beak=smoothstep(2.812,2.870,p[...,2]+.012*(broad-.5))
        # Premultiply the undyed keratin against the default live dye. Directly
        # mixing neutral grey and dark horn here creates a pale halo wherever
        # the dye mask fades out. The resulting base compensates that coverage.
        living=np.einsum('...k,kc->...c',weights,linear(COLORS))/.5+(1-weights.sum(-1))[...,None]
        wanted=base*living*(1-beak[...,None])+linear(np.array([.25,.235,.19]))*beak[...,None]
        weights*=1-beak[...,None]
        remaining=np.einsum('...k,kc->...c',weights,linear(COLORS))/.5+(1-weights.sum(-1))[...,None]
        base=wanted/np.maximum(.001,remaining)
        rough=rough*(1-beak)+.65*beak
        height=height*(1-beak)
        jaw_chart=(u>.80)&(v>.77)&(v<.865)&(p[...,2]>2.38)&(p[...,2]<2.83)&(p[...,1]<1.19)
        jaw_width=np.interp(p[...,2],[2.38,2.54,2.70,2.83],[.14,.14,.09,.035])
        lining=jaw_chart*(1-smoothstep(.64,.90,np.abs(p[...,0])/jaw_width))*smoothstep(.15,.65,n[...,1])
        living=np.einsum('...k,kc->...c',weights,linear(COLORS))/.5+(1-weights.sum(-1))[...,None]
        wanted=base*living*(1-lining[...,None])+linear(np.array([.12,.055,.045]))*lining[...,None]
        weights*=1-lining[...,None]
        remaining=np.einsum('...k,kc->...c',weights,linear(COLORS))/.5+(1-weights.sum(-1))[...,None]
        base=wanted/np.maximum(.001,remaining)
        rough=rough*(1-lining)+.48*lining;height*=1-lining
    else:
        # Original plate coordinates encode distance from root to tip even
        # after the final geometric unwrap changes the texture layout.
        plate=fields[...,12]>.5
        lateral=np.sin((v-.23)/.73*np.pi*2);growth=np.clip((u-.03)/.94,0,1)
        ridge=np.zeros_like(u)
        for vein in [-.68,-.34,.30,.63]:
            path=vein*(.38+.62*growth)+.025*np.sin(growth*8+vein*3)
            ridge+=np.exp(-((lateral-path)/.032)**2)
        ridge*=np.maximum(0,np.sin(growth*np.pi))**.6
        # Sparse branching vascular relief leaves broad quiet bone between veins.
        # A high-frequency sine made every blade read like straight woodgrain.
        vessels=np.zeros_like(u)
        for branch in range(7):
            origin=-.72+branch*.235
            split=.26+.055*(branch%4)
            path=origin*(.28+.72*growth)+.055*np.sin(growth*5.2+branch*1.7)
            branch_width=.010+.006*(1-growth)
            main=np.exp(-((lateral-path)/branch_width)**2)
            fork=path+(-1 if branch%2 else 1)*.30*np.maximum(0,growth-split)
            child=np.exp(-((lateral-fork)/(branch_width*.7))**2)*smoothstep(split,split+.08,growth)
            vessels+=main+child*.65
        vessels*=smoothstep(.06,.22,growth)*(1-smoothstep(.80,1,growth))
        height=.0010*ridge+.00035*vessels+.000055*(fine-.5)
        # Keratin lamellae follow the blade toward the crown. Root-to-tip
        # curvature changes their spacing; field noise breaks each band locally.
        outward=lateral/(.48+.52*growth)
        salt=noise3(p,3.8)
        pigment=noise3(p,2.2)*.58+noise3(p,7.1)*.30+noise3(p,18.0)*.12
        fiber=np.stack([outward*26+1.6*salt,growth*3.7,p[...,2]*.53],-1)
        lamella=noise3(fiber,1)
        fine_fiber=noise3(np.stack([outward*76+2.1*lamella,growth*8.5,p[...,0]*1.4],-1),1)
        margin=smoothstep(.72,.99,np.abs(lateral))*(.50+.50*growth)
        crown=smoothstep(.62,.98,growth+.14*(pigment-.5))*(.18+.48*salt)*plate
        # A constant source-face field survives the final anatomical unwrap,
        # including the embedded rings that follow the trunk bones.
        identity=np.maximum(0,np.rint(fields[...,12])-1)
        phase=identity*1.92
        # Partial growth lines swing toward an eccentric apical focus. Their
        # width and offset vary independently of the vertical keratin fibres.
        focus=.20*np.sin(phase+.4)
        sheet=growth+.21*(lateral-focus)**2+.074*lateral*np.sin(phase)+.024*(salt-.5)
        sheet+=.037*np.sin(3.1*lateral+phase)*smoothstep(.14,.65,growth)
        seasonal=np.sin(sheet*(37+4*np.cos(phase))+.83*np.sin(sheet*12+phase)+phase)
        chalk=smoothstep(.62,.93,seasonal)*smoothstep(.29,.75,salt+.24*np.sin(phase+2.6*lateral))
        root_axis=.09*np.sin(phase)+.13*growth
        central=np.exp(-((lateral-root_axis)/.24)**2)
        outer=np.exp(-((lateral+.55-.12*np.sin(phase)-.11*growth)/.20)**2)
        struts=(central+.68*outer)*(1-smoothstep(.22,.74,growth))
        # Each sheath has its own growth focus and polishing face. Isolated
        # scrape tracks cross a few fibres at the exposed outside margin.
        rubbed=margin*smoothstep(.35,.64,.55*salt+.30*fine_fiber+.15*np.sin(phase+5*growth))
        worn=plate*rubbed*smoothstep(.16,.50,growth)
        scratch=np.zeros_like(growth)
        for j in range(3):
            phase_j=phase+2.2*j
            anchor=.36+.45*(.5+.5*np.sin(phase_j))
            across=.43*np.sin(phase_j+.9)
            line=(lateral-across)*(.22+.07*np.cos(phase_j))+(growth-anchor)
            envelope=np.exp(-((lateral-across)/(.16+.06*np.sin(phase_j+.4)))**4)
            scratch+=np.exp(-(line/.009)**2)*envelope*smoothstep(.33,.67,fine_fiber+.18*salt)
        scratch=np.minimum(1,scratch)*plate
        collar=.19+.065*struts+.047*np.sin(3*lateral+phase)+.052*(salt-.5)
        rooted=(1-smoothstep(collar-.077,collar+.10,growth))*plate
        blade=plate.astype(np.float32)-rooted
        weathered=np.minimum(blade,crown+.31*chalk*blade+.20*worn)
        horn=np.minimum(blade-weathered,worn*.52+.23*scratch)
        weights[...,0]=rooted*.70
        weights[...,1]=rooted*.30
        weights[...,3]=blade-weathered-horn
        weights[...,4]=weathered
        weights[...,5]=np.logical_not(plate)+horn
        grey=.47+.47*(pigment-.5)+.19*(lamella-.5)+.087*(fine_fiber-.5)
        grey+=plate*(.059*(chalk-.30)+.087*struts-.081*vessels+.19*worn+.084*np.sin(phase)*blade+.14*scratch)
        grey+=.038*ridge
        height+=plate*(.00172*(lamella-.5)+.00064*(fine_fiber-.5)+.0011*chalk+.0024*struts-.00073*worn-.00082*scratch)
        rough=.57+.18*pigment+.10*(lamella-.5)+.045*chalk-.17*worn+.075*scratch
        # Minute pebbled skin follows the living insertion onto the plate,
        # before yielding to smooth keratin. Keep the collar within the
        # existing dorsal/hide dye regions and roughness range of the trunk.
        bed=rooted>.005
        near,far,scale_tone=cells(p[bed],np.float32(.032))
        ridge_skin=smoothstep(.008,.22,far-near)
        bed_grey=.48+.14*(scale_tone-.5)+.24*(broad[bed]-.5)-.057*(1-ridge_skin)
        grey[bed]=grey[bed]*(1-rooted[bed])+bed_grey*rooted[bed]
        height[bed]=height[bed]*(1-rooted[bed])+rooted[bed]*(.0017*ridge_skin+.00067*np.maximum(0,1-near))
        rough[bed]=rough[bed]*(1-rooted[bed])+rooted[bed]*(.58+.18*(1-ridge_skin))
        base=np.repeat(np.clip(grey,.13,.85)[...,None],3,-1)
        occ=.97-.065*np.minimum(1,vessels)*plate
        eye=v>.969;iris=eye&(u<.24)
        mouth=(p[...,2]>2.21)&(p[...,2]<2.88)&(p[...,1]>.98)&(p[...,1]<1.23)&(np.abs(p[...,0])<.165)&~eye
        nails=(p[...,1]<.24)
        beak=(p[...,2]>2.74)&~eye&~mouth
        for mask,color,r in [(eye,[.035,.028,.020],.24),(iris,[.49,.28,.07],.22),(mouth,[.16,.065,.055],.40),(nails,[.16,.15,.11],.50),(beak,[.25,.235,.19],.65)]:
            weights[mask]=0;base[mask]=linear(np.array(color));rough[mask]=r;height[mask]=0;occ[mask]=1
        # The amber iris has a darker outer limbus, radial fibres and a shaded
        # superior sector under the lid. Its pupil and catchlight respond to
        # the actual eye geometry and lighting.
        iris_z=(p[...,2]-2.52175)/.0255
        iris_y=(p[...,1]-1.320)/.027
        iris_radius=np.sqrt(iris_z*iris_z+iris_y*iris_y)
        angle=np.arctan2(iris_y,iris_z)
        ray=.5+.5*np.sin(31*angle+3*np.sin(6*angle)+4*iris_radius)
        amber=np.stack([.36+.25*ray,.18+.18*ray,.060+.055*ray],-1)
        limbus=smoothstep(.61,.98,iris_radius)
        glint_tone=1-.25*smoothstep(.1,.9,iris_y)
        iris_rgb=amber*glint_tone[...,None]*(1-.53*limbus[...,None])
        base[iris]=linear(iris_rgb[iris])
        rough[iris]=(.17+.065*limbus)[iris]
        tongue=mouth&(v>.025)&(v<.20)&(u>.76)
        # The deep throat and side-wall crease receive restrained cavity
        # occlusion; the convex tongue remains distinct from that recess.
        depth=1-smoothstep(2.42,2.77,p[...,2])
        occ[mouth]=(.78-.42*depth)[mouth]
        # The living gingival wall is distinct from the darker posterior
        # recess and oral floor. Follow the actual tapered dentary width;
        # uniform maroon made its concave section read as a flat insert.
        oral_width=np.interp(p[...,2],[2.21,2.40,2.54,2.70,2.84],[.09,.145,.157,.125,.032])
        gum=smoothstep(.52,.91,np.abs(p[...,0])/oral_width)*(1-.65*depth)
        oral_color=linear(np.array([.13,.053,.043]))+(linear(np.array([.27,.12,.085]))-linear(np.array([.13,.053,.043])))*gum[...,None]
        base[mouth]=(oral_color*(.94+.12*broad[...,None]))[mouth]
        rough[mouth]=(.46-.09*gum)[mouth]
        base[tongue]=linear(np.array([.30,.15,.10]))*(.88+.20*broad[tongue,None]);occ[tongue]=.86
        sulcus=np.exp(-(p[...,0]/.006)**2)*smoothstep(2.54,2.59,p[...,2])*(1-smoothstep(2.75,2.80,p[...,2]))
        height+=(-.0015*sulcus+.0002*(fine-.5))*tongue;rough[tongue]=.42
        height[beak]=0
        rough[beak]=(.61+.10*broad)[beak]
    # Growth runs along the keratin sheath toward its worn opposing edge. This
    # field crosses the skin/horn material boundary without a second seam.
    amount=beak.astype(np.float32)if name!='stego_skin'else beak
    line=np.sin(p[...,0]*390+p[...,1]*105+noise3(p,12)*2.0)
    coarse=np.sin(p[...,0]*100+p[...,1]*21+noise3(p,5)*1.7)
    keratin=.00055*line+.00075*coarse
    wear=smoothstep(2.91,3.0,p[...,2])*(1-smoothstep(1.105,1.15,p[...,1]))
    tint=(.80+.32*broad+.07*line+.06*coarse)[...,None]
    base*=1-amount[...,None]+amount[...,None]*tint
    base=base*(1-(wear*amount*.25)[...,None])+linear(np.array([.37,.34,.25]))*(wear*amount*.25)[...,None]
    height+=keratin*amount
    if name=='stego_skin':hoof_walls(p,base,weights,rough,height)
    # The nearly fully dyed anatomical surfaces set neutral exposure. Partly
    # undyed boundaries retain their compensated keratin/base interpolation.
    fully_dyed=weights.sum(-1)>.999
    gain=.5/max(.001,float(base[fully_dyed].mean()))
    base*=1+(gain-1)*weights.sum(-1)[...,None]
    if name == 'stego_horn':
        spike = valid & ~plate & (p[..., 2] < -4.9)
        base[spike], weights[spike], rough[spike], occ[spike] = spike_sheath(p[spike], n[spike])
    save(name+'_base.png',srgb(base))
    save(name+'_normal.png',normal_from_height(fields,height,valid)*.5+.5)
    save(name+'_height.png',(height-height.min())/max(.00001,float(height.max()-height.min())))
    save(name+'_packed.png',np.stack([occ,rough,np.zeros_like(rough)],-1))
    save(name+'_mask.png',weights[...,:3]);save(name+'_mask2.png',weights[...,3:])
    mixed=np.einsum('...k,kc->...c',weights,linear(COLORS))/.5+(1-weights.sum(-1))[...,None]
    save(name+'_preview.png',srgb(base*mixed))
    # Authored wound groups follow a few plausible strike directions. Surface
    # noise only breaks their edges; it never distributes random red blobs.
    small=fields[::4,::4];pp=small[...,:3];grain=noise3(pp,39)
    hurt=np.zeros((*pp.shape[:-1],4),dtype=np.float32)
    if name=='stego_skin':
        # Evaluate two samples per axis at the final 512-pixel injury map.
        # A narrow, curved scratch can cross an entire output pixel; using
        # its centre alone left regular gaps in those cuts after filtering.
        wound_field=fields[::2,::2]
        pp=wound_field[...,:3]
        grain=noise3(pp,38)
        cuts=np.zeros_like(grain); abrasion=np.zeros_like(grain)
        wounds=[(.72,1.70,.28,-.56,1,[-.025,.037]),(-.67,1.55,.34,.42,1,[0]),
                (-1.18,2.03,.21,-.27,-1,[-.047,.012,.070]),(.12,1.64,.27,.65,-1,[-.018,.040]),
                (-2.65,1.44,.30,-.11,-1,[0]),(1.09,.59,.11,-1.8,-1,[]),(-.56,.83,.13,1.4,1,[.012])]
        for group,(zc,yc,length,slope,side,offsets) in enumerate(wounds):
            along=(pp[...,2]-zc)/length
            exterior=smoothstep(.12,.24,pp[...,0]*side)*smoothstep(.14,.62,wound_field[...,3]*side)
            for scratch,offset in enumerate(offsets or [0]):
                reach=.70+.28*np.sin(group*1.7+scratch*2.3)**2
                local=along/reach
                taper=np.maximum(0,1-local*local)**.72
                centre=yc+offset+(slope+.09*scratch)*(pp[...,2]-zc)+(.009+.003*group)*np.sin(local*2.2+group)+.006*(grain-.5)
                distance=np.abs(pp[...,1]-centre)
                section=(1-smoothstep(.001*taper,.016*taper+.0003,distance))*taper*exterior
                if offsets:
                    cuts=np.maximum(cuts,section*(.79+.21*grain))
                width=(.015+.014*(1+np.sin(local*4+group+scratch)))*taper
                rubbed=(1-smoothstep(.003*taper,width+.001,distance))*taper*exterior
                abrasion=np.maximum(abrasion,rubbed*(.44+.56*smoothstep(.24,.75,grain)))
        # Alpha selects the activation threshold, including at the antialiased
        # edge; RGB transitions from local hide through a worn scale margin
        # to the incision, avoiding a single opaque stencil at full injury.
        skin=srgb(np.clip((base*mixed)[::2,::2],0,1))
        dry=np.stack([.31+.10*grain,.25+.08*grain,.15+.07*grain],-1)
        fresh=np.stack([.31+.10*grain,.105+.044*grain,.072+.04*grain],-1)
        rub=smoothstep(.045,.56,abrasion)
        blood=smoothstep(.045,.52,cuts)
        color=skin+(dry-skin)*rub[...,None]
        color+=(fresh-color)*blood[...,None]
        exposed=np.maximum(rub,blood)
        threshold=np.maximum(.91*rub*(1-.83*blood),(.16+.41*blood)*blood)
        def reduce(values):
            return (values[::2,::2]+values[1::2,::2]+values[::2,1::2]+values[1::2,1::2])*.25
        covered=reduce(exposed)
        hurt[...,:3]=reduce(color*exposed[...,None])/np.maximum(covered[...,None],1e-8)
        hurt[...,3]=reduce(threshold)
        pp=small[...,:3];grain=noise3(pp,39)
    else:
        growth=np.clip((small[...,10]-.03)/.94,0,1)
        lateral=np.sin((small[...,11]-.23)/.73*np.pi*2)
        blade=(small[...,11]>.21)&(small[...,11]<.969)
        exposed=noise3(pp,1.8)>.50
        scratch=np.zeros_like(grain)
        for offset in [-.37,.22]:
            distance=np.abs(lateral-(offset+.38*(growth-.5)))
            scratch=np.maximum(scratch,(1-smoothstep(.015,.05,distance))*smoothstep(.48,.61,growth)*(1-smoothstep(.83,.96,growth)))
        wear=blade&exposed&(scratch>.25)&(grain>.27)
        hurt[...,:3]=np.stack([.39+.12*grain,.31+.10*grain,.20+.08*grain],-1)
        hurt[...,3]=np.where(wear,.45+.40*grain,0)
    # The renderer already desaturates and dulls the whole corpse. Local decay
    # adds restrained mottling in dependent soft tissue, not solid green spots.
    decay=np.zeros_like(hurt);patch=noise3(pp,4.7)
    dependent=(1-smoothstep(1.2,2.1,pp[...,1])) if name=='stego_skin' else np.zeros_like(patch)
    mottled=(patch>.62)&(hurt[...,3]==0)&(dependent>.15)
    decay[...,:3]=np.stack([.145+.065*grain,.14+.055*grain,.095+.045*grain],-1)
    decay[...,3]=np.where(mottled,.10+.22*patch*dependent,0)
    save(name+'_hurt.png',hurt);save(name+'_decay.png',decay)
    print('Painted',name,'on',int(data['valid'].sum()),'covered texels',flush=True)


def main(folder):
    for name in ['stego_skin','stego_horn']:paint(folder,name)
    saddle()
