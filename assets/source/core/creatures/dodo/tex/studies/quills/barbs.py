"""Anatomical microstructure on the approved feather envelopes.

Real curves, not periodic edge notches: each filament starts at the rachis,
curves towards its point on the vane, and terminates individually. Neighbouring
filaments share a little length variation, forming soft uneven clumps. The
rounded terminal cap gets longer free ends. Inputs and dimensions are metres.
"""
import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import gaussian_filter, gaussian_filter1d, distance_transform_edt


def fibres(alpha,shaft_x,pixel_m,seed,symmetric=False):
    size=alpha.shape[0];S=4
    rng=np.random.default_rng(seed)
    mask=alpha>=.5
    yy,xx=np.mgrid[:size,:size]
    row=np.arange(size)
    shaft=np.broadcast_to(shaft_x,alpha.shape)[:,0]
    rows=np.flatnonzero(mask.any(axis=1))
    y0,y1=rows.min(),rows.max();length=y1-y0
    t=(yy-y0)/length
    # Smooth only the submillimetre boundary before resolving it into barbs.
    # Macro width, bend, tip and root come directly from the round 2 envelope.
    left=np.array([np.flatnonzero(m)[0] if m.any() else shaft[i] for i,m in enumerate(mask)],float)
    right=np.array([np.flatnonzero(m)[-1] if m.any() else shaft[i] for i,m in enumerate(mask)],float)
    sigma=.00020/pixel_m
    left=gaussian_filter1d(left,sigma);right=gaussian_filter1d(right,sigma)
    strand_im=Image.new('L',(size*S,size*S));strand=ImageDraw.Draw(strand_im)
    fringe_im=Image.new('L',(size*S,size*S));fringe=ImageDraw.Draw(fringe_im)
    split_im=Image.new('L',(size*S,size*S));split_draw=ImageDraw.Draw(split_im)
    path_count=0
    for sign,edge in [(-1,left),(1,right)]:
        start=y0+length*.055
        sy=np.linspace(start,y1,2400)
        sx=np.interp(sy,row,edge)
        # Close each half of the rounded cap. A row-scanned boundary has a
        # short horizontal final span too; omitting it leaves a square nick.
        sx=np.r_[sx,(left[y1]+right[y1])*.5]
        sy=np.r_[sy,y1+.5]
        outline=np.stack([sx,sy],-1)
        arc=np.r_[0,np.cumsum(np.linalg.norm(np.diff(outline,axis=0),axis=1))]
        positions=[];pos=0.
        while pos<arc[-1]:
            positions.append(pos);pos+=rng.uniform(.00014,.00022)/pixel_m
        positions=np.array(positions)
        count=len(positions)
        ex=np.interp(positions,arc,sx);ey=np.interp(positions,arc,sy)
        # Correlated, nonperiodic endpoint variation. A clump has several
        # separate slender tips; it is not a triangular bite in the outline.
        clump=gaussian_filter1d(rng.normal(size=count),2.5)
        clump/=max(float(clump.std()),1e-6)
        micro=rng.normal(0,.065,count)
        end_shift_mm=np.clip(clump*.30+micro,-.55,.50)
        et=(ey-y0)/length
        end_shift_mm*=1+.55*np.clip((et-.76)/.24,0,1)
        # Rare groups of parted barbs, sparse and asymmetric on side feathers.
        gaps=np.zeros(count)
        candidates=np.flatnonzero((et>.28)&(et<.94))
        for g in rng.choice(candidates,size=4,replace=False):
            gaps[max(0,g-1):g+2]=rng.uniform(.40,.85)
        group_value=gaussian_filter1d(rng.normal(size=count),2.0)
        group_value/=max(float(group_value.std()),1e-6)
        strength=np.clip(.64+.19*group_value,.24,1.)
        for k,(xend,yend) in enumerate(zip(ex,ey)):
            path_count+=1
            distal=np.clip((et[k]-.78)/.22,0,1)
            lateral=abs(xend-np.interp(yend,row,shaft))
            root_y=yend-.74*lateral-.12*length*distal**1.6
            root_y=max(y0+length*.035,root_y)
            root_x=np.interp(root_y,row,shaft)
            end=np.array([xend,yend]);startp=np.array([root_x,root_y])
            vec=end-startp;vlen=np.linalg.norm(vec)
            if vlen<3:continue
            tangent=vec/vlen
            # A slightly bowed barb joins the shaft smoothly, then unzips at
            # its own end. It keeps the source's downward/outward growth.
            side=np.array([-tangent[1],tangent[0]])
            bow=sign*(.14+.035*np.sin(k*.027))*lateral
            control1=startp+vec*.30+side*bow
            control2=startp+vec*.72+side*bow*.65
            end += tangent*(end_shift_mm[k]-gaps[k])*.001/pixel_m
            u=np.linspace(0,1,max(12,int(vlen/3)))[:,None]
            path=(1-u)**3*startp+3*(1-u)**2*u*control1+3*(1-u)*u*u*control2+u**3*end
            coords=[tuple(p*S) for p in path]
            # The value ridge and the physical filament share the same path.
            width_mm=rng.uniform(.085,.135)
            sw=max(1,int(round(width_mm*.001/pixel_m*S)))
            strand.line(coords,fill=int(255*strength[k]),width=sw,joint='curve')
            # Broader feather-alpha coverage represents the small attached
            # barbules; the very end tapers to a hair instead of a square cap.
            aw=max(1,int(round(rng.uniform(.145,.185)*.001/pixel_m*S)))
            fringe.line(coords[:-2],fill=255,width=aw,joint='curve')
            fringe.line(coords[-3:],fill=255,width=max(1,int(aw*.65)),joint='curve')
            if gaps[k]>0:
                # Tiny curved clefts, along a barb rather than across it.
                end0=np.array([xend,yend])
                q=np.linspace(0,1,12)[:,None]
                cleft=end*(1-q)+end0*q
                split_draw.line([tuple(p*S) for p in cleft],fill=255,width=max(1,int(.10*.001/pixel_m*S)))
    def reduce(im):return np.asarray(im.resize((size,size),Image.Resampling.BOX)).astype(np.float32)/255
    lines=reduce(strand_im);strands=reduce(fringe_im);splits=reduce(split_im)
    # Smooth base mask with an explicit free-barb zone. No blurred edge is
    # used to fake fluff: the alpha 0.5 crossing is the individual filaments.
    soft=gaussian_filter(mask.astype(np.float32),.00022/pixel_m)>.5
    signed=distance_transform_edt(soft)-distance_transform_edt(~soft)
    depth=(.00032+.00028*np.clip((t-.70)/.28,0,1))/pixel_m
    core=np.clip((signed-depth)/(.00025/pixel_m)+.5,0,1)
    result=np.maximum(core,strands)
    # Keep the exposed calamus and its approved root position unchanged.
    root_blend=np.clip((t-.045)/.035,0,1)
    result=result*root_blend+alpha*(1-root_blend)
    result*=1-splits*np.clip((depth-signed+2)/(depth+2),0,1)
    # Filaments are permitted less than 1 mm beyond the approved envelope.
    result=np.where(signed>=-.00085/pixel_m,result,0)
    # Do not let small transparency wisps become disconnected floating dots.
    from scipy.ndimage import label
    lab,n=label(result>=.5);counts=np.bincount(lab.ravel());counts[0]=0
    connected=lab==counts.argmax()
    result[distance_transform_edt(~connected)>1.5]=0
    # A source-defined invariant, including all added filament layers.
    if symmetric:
        for a in [result,lines,strands,splits]:
            a[:,size//2:]=a[:,:size//2][:,::-1]
    structure=lines-gaussian_filter(lines,8)
    return dict(alpha=result,barbs=structure,barb_lines=lines,fringe=strands,splits=splits,
                count=path_count)
