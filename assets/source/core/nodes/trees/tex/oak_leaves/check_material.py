#!/usr/bin/env python3
"""Independent material checks and review pictures. Uses only delivered maps,
layout metadata and the builder's labelled botanical detail provenance.
Run: python3 -B check_material.py
"""
from pathlib import Path
import hashlib
import json
import struct
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage as ndi
from scipy.spatial import ConvexHull

ROOT=Path(__file__).resolve().parent
OUT=ROOT/'checks'
LAYOUT=json.loads((ROOT/'guide/LAYOUT.json').read_text())
RANGE_MM=160.0


def save(a,name):
    if not isinstance(a,Image.Image):a=Image.fromarray(np.uint8(np.clip(np.rint(a),0,255)))
    a.save(OUT/name,**({'quality':95,'subsampling':0} if name.endswith('.jpg') else {}))


def linear(rgb):
    a=rgb/255.
    return np.where(a<=.04045,a/12.92,((a+.055)/1.055)**2.4)


def srgb(a):
    a=np.maximum(a,0)
    return 255*np.where(a<=.0031308,12.92*a,1.055*a**(1/2.4)-.055)


def resize(a,size):
    if a.ndim==3:return np.stack([resize(a[...,i],size) for i in range(a.shape[-1])],-1)
    return np.asarray(Image.fromarray(a.astype(np.float32)).resize(size,Image.Resampling.BOX))


def composite(b,bg=(115,115,115),size=None,cut=True):
    rgb=b[...,:3].astype(float);a=b[...,3]/255.
    if size is not None:
        rgb=srgb(resize(linear(rgb),size));a=resize(a,size)
    if cut:a=(a>=.5).astype(float)
    return rgb*a[...,None]+np.array(bg)*(1-a[...,None])


def font(size):
    for p in ['/System/Library/Fonts/Supplemental/Arial.ttf','/System/Library/Fonts/Helvetica.ttc']:
        if Path(p).exists():return ImageFont.truetype(p,size)
    return ImageFont.load_default()


def sheet(panels,labels,cols,w=512,h=512):
    rows=(len(panels)+cols-1)//cols
    im=Image.new('RGB',(cols*w,rows*(h+40)),(26,29,27));d=ImageDraw.Draw(im)
    for i,(p,label) in enumerate(zip(panels,labels)):
        if not isinstance(p,Image.Image):p=Image.fromarray(np.uint8(np.clip(p,0,255)))
        p.thumbnail((w,h),Image.Resampling.LANCZOS)
        x=(i%cols)*w;y=(i//cols)*(h+40)
        im.paste(p,(x+(w-p.width)//2,y+40+(h-p.height)//2));d.text((x+14,y+10),label,fill=(226,231,220),font=font(17))
    return im


def outline(mask):
    yy,xx=np.nonzero(mask);pts=np.stack([xx,yy],-1)
    hull=ConvexHull(pts);im=Image.new('1',mask.shape[::-1])
    ImageDraw.Draw(im).polygon([tuple(x) for x in pts[hull.vertices]],fill=1)
    # Fixed outline and hole-filled scalloped envelope; neither is refitted at mips.
    env=ndi.binary_fill_holes(ndi.binary_closing(mask,iterations=6))
    env|=mask
    return np.array(im,dtype=float),env.astype(float)


def lighting(base,normal,orm,direction):
    n=normal.astype(float)/255*2-1;n/=np.linalg.norm(n,axis=-1,keepdims=True)
    l=np.array(direction,float);l/=np.linalg.norm(l)
    ndl=np.maximum(0,np.sum(n*l,axis=-1))
    ao=orm[...,0]/255.;rough=orm[...,1]/255.
    # No cast shadows. Diffuse 0.5–1 base-colour diagnostic plus very broad GGX.
    half=l+np.array([0,0,1]);half/=np.linalg.norm(half)
    ndh=np.maximum(0,np.sum(n*half,axis=-1));ndv=np.maximum(.001,n[...,2])
    a2=rough**4
    D=a2/(np.pi*np.maximum((ndh*ndh*(a2-1)+1)**2,1e-6))
    k=(rough+1)**2/8
    G=(ndl/(ndl*(1-k)+k))*(ndv/(ndv*(1-k)+k))
    spec=.04*D*G/np.maximum(4*ndv,1e-5)
    color=base[...,:3]*(.5+.5*ndl[...,None])*(.83+.17*ao[...,None])
    color+=srgb(spec[...,None]*.035)
    a=base[...,3]>=128
    return np.where(a[...,None],color,[70,73,70])


def margins_for(i,shape):
    h,w=shape;m=np.zeros(shape,bool)
    m[:12]=True;m[-12:]=True;m[:,:12]=True;m[:,-12:]=True
    if i<4:m[-12:,246:266]=False
    elif i==4:m[:12,12:w-12]=False
    elif i==5:m[-12:,232:280]=False
    else:m[:]=False
    return m


def normal_check(height,normal,r):
    x0,y0,x1,y1=r['box'];z=height[y0:y1,x0:x1].astype(float)*RANGE_MM/65535
    px=1000*r['metres_across']/z.shape[1]
    py=1000*r.get('metres_down',r['metres_across'])/z.shape[0]
    if r['what']=='mass':
        gx=(np.roll(z,-1,axis=1)-np.roll(z,1,axis=1))/(2*px)
        gy=(np.roll(z,-1,axis=0)-np.roll(z,1,axis=0))/(2*py)
    else:gy,gx=np.gradient(z,py,px)
    expected=np.stack([-gx,gy,np.ones_like(z)],-1)
    expected/=np.linalg.norm(expected,axis=-1,keepdims=True)
    delivered=normal[y0:y1,x0:x1].astype(float)/127.5-1
    delivered/=np.linalg.norm(delivered,axis=-1,keepdims=True)
    dot=np.sum(expected*delivered,axis=-1)
    angle=np.degrees(np.arccos(np.clip(dot,-1,1)))
    flipped=delivered.copy();flipped[...,1]*=-1
    wrong=np.degrees(np.arccos(np.clip(np.sum(flipped*expected,axis=-1),-1,1)))
    return dict(mean_degrees=float(angle.mean()),max_degrees=float(angle.max()),
                flipped_green_mean_degrees=float(wrong.mean()),mm_per_pixel=[px,py])


def tile_stats(a):
    a=a.astype(float)
    dx=np.abs(np.diff(a,axis=1));dy=np.abs(np.diff(a,axis=0))
    sx=np.abs(a[:,0]-a[:,-1]);sy=np.abs(a[0]-a[-1])
    return dict(horizontal_seam_mean=float(sx.mean()),vertical_seam_mean=float(sy.mean()),
                interior_horizontal_mean=float(dx.mean()),interior_vertical_mean=float(dy.mean()),
                seam_to_interior_x=float(sx.mean()/max(dx.mean(),1e-8)),
                seam_to_interior_y=float(sy.mean()/max(dy.mean(),1e-8)))


def purpose(base,normal,orm):
    """Sample each card's own mips BEFORE alpha test, at each viewing distance.
    Shared shell normals; supplied detail normals, AO and roughness are used.
    This is a metric material diagnostic, not an engine capture.
    """
    rng=np.random.default_rng(21103)
    positions=[(.80,.82),(1.45,.67),(2.06,.81),(.63,1.17),(1.25,1.11),
               (1.93,1.15),(2.37,1.16),(1.03,1.49),(1.73,1.45),(.49,.87),
               (2.30,.74),(1.43,1.54),(.96,.55),(1.83,.55)]
    placements=[]
    for i,p in enumerate(positions):
        top=p[1]<.9 and .65<p[0]<2.2
        placements.append(dict(center_m=list(p),cell=([0,2] if top else [1,3])[i%2],
            role='sun_top' if top else 'shade_rim',shortening=float(rng.uniform(.58,.96)),
            angle=float(rng.uniform(-np.pi,np.pi))))
    lights={'frontlit':[-.40,.60,.69282],'backlit':[0,.65,-.75993]}
    def mip(b,n,o,size):
        return dict(rgb=resize(linear(b[...,:3].astype(float)),size),
                    alpha=resize(b[...,3]/255.,size),
                    normal=resize(n.astype(float)/127.5-1,size),orm=resize(o/255.,size))
    def sample(layer,uv,wrap=False):
        mode='grid-wrap' if wrap else 'nearest'
        if layer.ndim==2:return ndi.map_coordinates(layer,uv,order=1,mode=mode)
        return np.stack([ndi.map_coordinates(layer[...,k],uv,order=1,mode=mode)
                         for k in range(layer.shape[-1])],-1)
    def light(rgb,detail,macro,ao,rough,direction):
        tangent=np.stack([macro[...,2],np.zeros(macro.shape[:2]),-macro[...,0]],-1)
        tangent/=np.linalg.norm(tangent,axis=-1,keepdims=True)
        bitangent=np.cross(macro,tangent)
        n=tangent*detail[...,:1]+bitangent*detail[...,1:2]+macro*detail[...,2:3]
        n/=np.linalg.norm(n,axis=-1,keepdims=True)
        l=np.array(direction);l/=np.linalg.norm(l)
        direct=np.maximum(0,np.sum(n*l,axis=-1))
        # The closed shell hides the sun below its geometric horizon. Strong
        # detail normals must not light the rear surface through the shell.
        direct*=np.sum(macro*l,axis=-1)>0
        # Calibrated to the brief's DISPLAY response: unoccluded sky ~0.5x
        # base, head-on sun ~1.0x. No bounce, cast shadow or automatic exposure.
        # AO attenuates the sky component only. A small broad sky sheen uses
        # the delivered roughness; no artificial silhouette rim is added.
        gain=.5*(.65+.35*ao)+.5*direct
        sheen=(1-rough)**2*18*(.4+.6*(1-n[...,2])**2)
        return np.clip(srgb(rgb)*gain[...,None]+sheen[...,None],0,255),direct
    def render(distance,viewport,card_limit=None):
        ppm=(viewport/2)/distance;size=(round(ppm*3),round(ppm*2.1));w,h=size
        y,x=np.mgrid[:h,:w];x=(x+.5)*3/w;y=(y+.5)*2.1/h
        u=(x-1.5)/1.2;v=(y-1.05)/.75;r2=u*u+v*v
        shell=r2<=1
        macro=np.stack([u*.65,-v*.65,np.sqrt(np.maximum(.05,1-.60*r2))],-1)
        macro/=np.linalg.norm(macro,axis=-1,keepdims=True)
        mass=mip(base[1024:],normal[1024:],orm[1024:],(round(ppm*4.8),round(ppm*2.4)))
        uv=[y/2.4*mass['alpha'].shape[0]-.5,x/4.8*mass['alpha'].shape[1]-.5]
        plain={key:sample(val,uv,True) for key,val in mass.items()}
        covered={key:val.copy() for key,val in plain.items()}
        visible=shell.copy();card_index=np.full((h,w),-1,int)
        # Two top cards plus two hanging/rim cards in the sparse diagnostic.
        active_placements=placements if card_limit is None else [placements[i] for i in [0,1,7,8]]
        for k,p in enumerate(active_placements):
            cell=LAYOUT['cells'][p['cell']];x0,y0,x1,y1=cell['box']
            mw=max(2,round(ppm*.9));mh=max(2,round(ppm*.9*p['shortening']))
            card=mip(base[y0:y1,x0:x1],normal[y0:y1,x0:x1],orm[y0:y1,x0:x1],(mw,mh))
            dx=x-p['center_m'][0];dy=y-p['center_m'][1]
            c=np.cos(p['angle']);s=np.sin(p['angle'])
            a=(dx*c+dy*s)/.9+.5;b=(-dx*s+dy*c)/(.9*p['shortening'])+.5
            uv=[b*mh-.5,a*mw-.5]
            values={key:sample(val,uv) for key,val in card.items()}
            active=(a>=0)&(a<=1)&(b>=0)&(b<=1)&(values['alpha']>=.5)
            nx=values['normal'][...,0].copy();ny=values['normal'][...,1].copy()
            values['normal'][...,0]=c*nx+s*ny
            values['normal'][...,1]=-s*nx+c*ny
            for key in covered:covered[key][active]=values[key][active]
            card_index[active]=k;visible|=active
        result={}
        for name,direction in lights.items():
            pictures={};measure={}
            for kind,data,alpha in [('mass',plain,shell),('cards',covered,visible)]:
                col,direct=light(data['rgb'],data['normal'],macro,data['orm'][...,0],data['orm'][...,1],direction)
                view=np.where(alpha[...,None],col,[157,190,219])
                suffix='' if viewport==1920 else f'_{viewport}px'
                if card_limit is not None:suffix+='_sparse'
                filename=f'purpose_{name}_{distance:02d}m_{kind}{suffix}.png';save(view,filename)
                pictures[kind]=view
                core=(r2<.48)&alpha
                measure[kind+'_core_rgb_mean']=col[core].mean(0).tolist()
                measure[kind+'_core_direct_sun_max']=float(direct[core].max())
            core=(r2<.65)&(card_index>=0)
            difference=pictures['cards']-pictures['mass']
            measure['card_replacement_mean_absolute_rgb']=float(np.abs(difference[core]).mean())
            measure['card_replacement_mean_rgb']=difference[core].mean(0).tolist()
            measure['interior_opaque']=bool(np.all(visible[shell]))
            roles=np.array([p['role']=='sun_top' for p in active_placements])
            sun=(card_index>=0)&roles[np.maximum(card_index,0)]&shell
            shade=(card_index>=0)&~roles[np.maximum(card_index,0)]&shell
            mass_visible=shell&(card_index<0)
            measure['visible_role_rgb']={role:pictures['cards'][mask].mean(0).tolist()
                for role,mask in [('sun_top',sun),('shade_rim',shade),('interior',mass_visible)]}
            role_rgb=measure['visible_role_rgb']
            luma=np.array([.2126,.7152,.0722])
            measure['sun_to_shade_luminance_ratio']=float(np.dot(role_rgb['sun_top'],luma)/np.dot(role_rgb['shade_rim'],luma))
            measure['sun_to_interior_luminance_ratio']=float(np.dot(role_rgb['sun_top'],luma)/np.dot(role_rgb['interior'],luma))
            result[name]=dict(images=pictures,measurements=measure,size_px=list(size))
        return result
    results={d:render(d,1920) for d in [5,30,60]}
    screenshot_scale=render(30,1600)
    sparse=render(30,1920,4)
    panels=[];labels=[]
    for name in lights:
        for d in [5,30,60]:
            for kind in ['mass','cards']:
                panels.append(results[d][name]['images'][kind])
                labels.append(f'{name} | {d} m | {kind} | {results[d][name]["size_px"]} px')
    save(sheet(panels,labels,2,620,430),'purpose_distance.jpg')
    panels=[];labels=[]
    for name in lights:
        for kind in ['mass','cards']:
            im=Image.fromarray(np.uint8(results[30][name]['images'][kind]))
            panels.append(im.resize((768,536),Image.Resampling.NEAREST))
            labels.append(f'{name}: {kind}, 30 m, 96 x 67 px enlarged x8')
    save(sheet(panels,labels,2,768,536),'purpose_30m_both_lights.png')
    panels=[];labels=[]
    for name in lights:
        for kind in ['mass','cards']:
            im=Image.fromarray(np.uint8(sparse[name]['images'][kind]))
            panels.append(im.resize((768,536),Image.Resampling.NEAREST))
            labels.append(f'{name}: sparse {kind}, 30 m, enlargement x8')
    save(sheet(panels,labels,2,768,536),'purpose_30m_sparse_both_lights.png')
    # The supplied concept is a painted close crop, without camera metadata.
    # A declared 10 cm blade / 12 px registration gives 120 px per metre.
    # Compare both at that ART scale as well as the calibrated 90-degree view.
    concept=Image.open(ROOT/'feedback/concept_crown_detail.png').convert('RGB')
    crop_box=(580,50,940,302)
    ref=concept.crop(crop_box)
    matched=render(30,7200)
    panels=[];labels=[]
    for name in lights:
        panels.extend([ref,matched[name]['images']['mass'],matched[name]['images']['cards']])
        labels.extend(['Concept / native 360 x 252 crop',f'{name} / mass / matched leaf scale',f'{name} / cards over mass / same scale'])
    save(sheet(panels,labels,3,400,270),'purpose_30m_concept_comparison.png')
    metric_ref=ref.resize((96,67),Image.Resampling.LANCZOS)
    panels=[];labels=[]
    for name in lights:
        for label,im in [('concept',metric_ref),('mass',Image.fromarray(np.uint8(results[30][name]['images']['mass']))),('cards',Image.fromarray(np.uint8(results[30][name]['images']['cards'])))]:
            panels.append(im.resize((576,402),Image.Resampling.NEAREST));labels.append(f'{name} / {label} / 96 x 67 px enlarged x6')
    save(sheet(panels,labels,3,576,402),'purpose_30m_concept_metric.png')
    return dict(horizontal_fov_degrees=90,viewport_width_px=1920,focal_length_px=960,
                frame_metres=[3.,2.1],billow_metres=[2.4,1.5],card_metres=.9,
                projection_30m_px=[96,67],cluster_30m_px=28.8,engine_capture=False,
                lights=lights,cards=placements,sparse_card_indices=[0,1,7,8],geometric_horizon_clipping=True,
                concept_registration=dict(crop_pixels=list(crop_box),assumed_leaf_mm=100,assumed_leaf_px=12,
                    pixels_per_metre=120,matched_frame_pixels=[360,252],
                    caveat='Art-scale match; reference has no metric camera metadata. Also supplied at calibrated 90-degree FOV, 1920 px, 30 m.'),
                sparse_4_cards={name:sparse[name]["measurements"] for name in lights},
                measurements={name:results[30][name]['measurements'] for name in lights},
                screenshot_scale_1600={name:screenshot_scale[name]['measurements'] for name in lights},
                note='Cells 0/2 on top; cells 1/3 around and below the rim. Per-card mip filtering, alpha cut 0.5, shared rounded macro normals plus rotated delivered detail normals. AO affects sky only; matte sky sheen uses ORM. No cast shadow, bounce, rim light, exposure adjustment or coverage boost.')


def main():
    OUT.mkdir(exist_ok=True)
    files={n:ROOT/f'oak_leaves_{n}.png' for n in ['base','height','normal','orm']}
    ims={n:Image.open(p) for n,p in files.items()}
    b=np.array(ims['base']);h=np.array(ims['height']);n=np.array(ims['normal']);o=np.array(ims['orm'])
    kinds=np.array(Image.open(ROOT/'source/material_ids.png'))
    metrics=dict(passed=False,height_range_mm=RANGE_MM,files={},regions=[],assertions=[])
    failures=[]
    def require(condition,msg):
        metrics['assertions'].append(dict(check=msg,passed=bool(condition)))
        if not condition:failures.append(msg)
    for key,p in files.items():
        head=p.read_bytes()[24:26]
        metrics['files'][key]=dict(file=p.name,size=list(ims[key].size),mode=ims[key].mode,
              bit_depth=int(head[0]),png_color_type=int(head[1]),srgb='srgb' in ims[key].info,
              sha256=hashlib.sha256(p.read_bytes()).hexdigest())
        require(ims[key].size==(2048,2048),key+' is 2048 square')
    require(b.shape==(2048,2048,4),'base RGBA')
    require(metrics['files']['height']['bit_depth']==16 and h.ndim==2,'height 16-bit grayscale')
    require(metrics['files']['base']['srgb'],'base explicitly tagged sRGB')
    require(all(not metrics['files'][k]['srgb'] for k in ['height','normal','orm']),'data maps linear / no sRGB tag')
    require(np.all(o[...,2]==0),'metalness is zero everywhere')
    panels=[composite(b,(70,73,70)),np.where((b[...,3]>=128)[...,None],np.repeat((h/257)[...,None],3,-1),70),
            np.where((b[...,3]>=128)[...,None],n,70),np.where((b[...,3]>=128)[...,None],o,70)]
    save(sheet(panels,['Base colour / sRGB RGBA','Height / 16-bit / 0–160 mm','OpenGL normal / physical scale','ORM / linear RGB'],2,768,768),'layers.jpg')
    save(b[...,3],'alpha.png')
    guide=np.asarray(Image.open(ROOT/'guide/layout.png').convert('RGB').resize((2048,2048)))
    a=b[...,3:4]/255.;save(b[...,:3]*a+guide*(1-a),'base_over_layout.png')
    marked=composite(b,(70,73,70));mip_panels={name:[] for name in ['grey','sky']}
    outline_data=[]
    for i,r in enumerate(LAYOUT['cells']):
        x0,y0,x1,y1=r['box'];sl=np.s_[y0:y1,x0:x1]
        cb=b[sl];co=o[sl];ch=h[sl];ca=cb[...,3];mask=ca>=128
        margins=margins_for(i,mask.shape);violations=int(np.count_nonzero(ca[margins]))
        require(violations==0,f'region {i}: no alpha in forbidden margins')
        marked[sl][margins]=marked[sl][margins]*.3+np.array([110,28,24])
        entry=dict(name=r['what'],box=r['box'],alpha_nonzero_in_margins=violations,
                   alpha_cut_coverage=float(mask.mean()),rgb_mean=cb[...,:3][mask].mean(0).tolist(),
                   rgb_min=cb[...,:3][mask].min(0).tolist(),rgb_max=cb[...,:3][mask].max(0).tolist(),
                   roughness_min=float(co[...,1][mask].min()/255),roughness_max=float(co[...,1][mask].max()/255),
                   roughness_mean=float(co[...,1][mask].mean()/255),
                   occlusion_min=float(co[...,0][mask].min()/255),occlusion_max=float(co[...,0][mask].max()/255),
                   height_used_mm=[float(float(ch[mask].min())*RANGE_MM/65535),float(float(ch[mask].max())*RANGE_MM/65535)])
        entry['normal_against_height']=normal_check(h,n,r)
        require(entry['normal_against_height']['max_degrees']<.5,f'region {i}: normal agrees with quantized height below 0.5 degree')
        require(np.all((ch[mask]>0)&(ch[mask]<65535)),f'region {i}: no clipped height endpoints')
        if i<6:
            # RGB padding is evaluated from the saved map, within each cell only.
            _,ix=ndi.distance_transform_edt(~mask,return_indices=True)
            nearest=cb[...,:3][tuple(ix)]
            err=np.abs(nearest.astype(float)-cb[...,:3])[ca==0]
            entry['transparent_rgb_padding_max_error']=float(err.max()) if err.size else 0.
            require(entry['transparent_rgb_padding_max_error']==0,f'region {i}: no transparent RGB fringe')
            edge=(ca>0)&(ca<255);distance=ndi.distance_transform_edt(ca<128)
            entry['soft_edge_outward_distance_p95_px']=float(np.percentile(distance[edge],95))
        if i<4:
            hull,env=outline(mask);ratios=[]
            leafy=mask & np.isin(kinds[sl],[2,5,6,7])
            ly,lx=np.nonzero(leafy)
            entry['leaf_bounds_px']=[int(lx.min()),int(ly.min()),int(lx.max()+1),int(ly.max()+1)]
            entry['leaf_margin_px']=[int(lx.min()),int(ly.min()),int(511-lx.max()),int(511-ly.max())]
            if i<3:
                require(max(entry['leaf_margin_px'][:3])<=30,f'cluster {i}: leaves reach within 30 px on left, top and right')
                require(mask.mean()>=.48,f'cluster {i}: occupied alpha covers at least 48 percent of full card')
            else:
                require(ly.min()<=30 and ly.max()>=465 and 280<=lx.max()-lx.min()+1<=370,
                        'cluster 3: long dense spray with intentionally narrower body')
                require(mask.mean()>=.28,'cluster 3: occupied alpha covers at least 28 percent of full card')
            holes=ndi.binary_fill_holes(mask)&~mask
            hole_ids,_=ndi.label(holes)
            hole_sizes=np.bincount(hole_ids.ravel())[1:]
            entry['largest_internal_gap_px']=int(hole_sizes.max()) if len(hole_sizes) else 0
            entry['largest_internal_gap_equivalent_diameter_mm']=float(2*np.sqrt(entry['largest_internal_gap_px']/np.pi)*900/512)
            require(entry['largest_internal_gap_equivalent_diameter_mm']<150,f'cluster {i}: no large empty center; largest internal gap below 15 cm')
            for factor in [1,2,4,8,16]:
                size=(512//factor,512//factor);aa=resize(ca/255.,size);kept=aa>=.5
                hu=resize(hull,size);en=resize(env,size)
                lab,count=ndi.label(kept,np.ones((3,3)));hist=np.bincount(lab.ravel());hist[0]=0
                ratios.append(dict(shrink=factor,size_px=list(size),alpha_vs_fixed_convex_outline=float(kept.sum()/hu.sum()),
                    alpha_vs_fixed_scalloped_outline=float(kept.sum()/en.sum()),
                    occupied_cell_fraction=float(kept.mean()),
                    largest_connected_fraction=float(hist.max()/max(1,kept.sum()))))
                if factor>1:
                    for name,bg in [('grey',(115,115,115)),('sky',(183,207,226))]:
                        view=composite(cb,bg,size=size)
                        save(view,f'cluster_{i}_mip_{factor:02d}_{name}.png')
                        mip_panels[name].append((view,f'Cluster {i} / 1:{factor} / {size[0]} px'))
            entry['mip_coverage']=ratios
            require(min(q['alpha_vs_fixed_scalloped_outline'] for q in ratios)>.90,f'cluster {i}: scalloped outline fill above 90 percent through sixteenth mip')
            require(all(.75<=q['alpha_vs_fixed_convex_outline']<=.85 for q in ratios),f'cluster {i}: convex outline coverage 75–85 percent at every shrink')
            require(all(q['largest_connected_fraction']>.98 for q in ratios),f'cluster {i}: connected at every shrink including sixteenth')
            require(ratios[3]['largest_connected_fraction']>.98,f'cluster {i}: eighth mip stays connected')
            require(ratios[0]['largest_connected_fraction']>.98,f'cluster {i}: native leaves attached to the shoot')
            turn=(kinds[sl]==7)&mask
            entry['turned_leaf_fraction']=float(turn.sum()/mask.sum())
            entry['turned_rgb_max']=cb[...,:3][turn].max(0).tolist() if turn.any() else [0,0,0]
            require(np.all(np.array(entry['turned_rgb_max'])<=np.array([120,128,100])),f'cluster {i}: underside brightness cap')
            entry['bright_neutral_fleck_fraction']=float(np.mean((cb[...,0][mask]>120)&(cb[...,2][mask]>100)))
            entry['fresh_fraction']=float(np.sum((kinds[sl]==5)&mask)/mask.sum())
            entry['brown_fraction']=float(np.sum((kinds[sl]==6)&mask)/mask.sum())
            if i==2:
                require(.01<=entry['fresh_fraction']<=.08,'cluster 2: localized fresh tips occupy 1–8 percent')
                require(0<entry['brown_fraction']<.02,'cluster 2: very few brown leaves, below 2 percent')
            foot=np.flatnonzero(mask[-1])
            require(len(foot)>0 and abs(float(foot.mean())-256)<4,f'cluster {i}: twig enters at middle of bottom edge')
            require(entry['turned_leaf_fraction']<.03,f'cluster {i}: undersides below 3 percent')
            require(float(co[...,1][mask & (kinds[sl]!=1)].min()/255)>=.929 and entry['roughness_max']<=.973,f'cluster {i}: leaf roughness 0.93–0.97 (twig 0.85)')
            require(entry['occlusion_min']>=.749,f'cluster {i}: AO at least 0.75')
            target=[128,132,70] if i in [0,2] else [86,98,62]
            entry['leaf_ecotype']='sun' if i in [0,2] else 'shade'
            entry['rgb_target']=target
            require(np.max(np.abs(np.array(entry['rgb_mean'])-target))<1.2,f'cluster {i}: prescribed mean colour')
            if i in [0,2]:
                mature=mask&(kinds[sl]==2)
                entry['mature_rgb_max']=cb[...,:3][mature].max(0).tolist()
                require(np.all(np.array(entry['mature_rgb_max'])<=[161,156,83]),
                        f'cluster {i}: mature sun pigments bounded below fresh tips')
            if i==2:
                fresh=mask&(kinds[sl]==5)
                entry['fresh_rgb_mean']=cb[...,:3][fresh].mean(0).tolist()
                entry['fresh_rgb_p95']=np.percentile(cb[...,:3][fresh],95,axis=0).tolist()
                require(np.max(np.abs(np.array(entry['fresh_rgb_p95'])-[165,160,85]))<6,
                        'cluster 2: brightest fresh tips near 165,160,85')
            outline_data.append(dict(cell=i,definition='fixed native convex hull of alpha >= 0.5; attachment included',
                                     native_scalloped_area_px=float(env.sum()),native_convex_area_px=float(hull.sum())))
        if i==4:
            require(abs(entry['roughness_mean']-.95)<.002,'moss roughness 0.95')
            size=(round(960*.6/20),round(960*1.2/20))
            moss=composite(cb,(70,73,70),size=size);save(moss,'moss_20m_actual.png')
            save(Image.fromarray(moss.astype(np.uint8)).resize((size[0]*8,size[1]*8),Image.Resampling.NEAREST),'moss_20m_enlarged.png')
            entry['20m_projection_px']=size
            entry['20m_alpha_area_px']=int(np.sum(resize(ca/255.,size)>=.5))
        if i==5:
            require(abs(entry['roughness_mean']-.92)<.002,'fern roughness 0.92')
            size=(round(960*.5/5),round(960*1.0/5))
            fernview=composite(cb,(61,54,42),size=size)
            save(fernview,'fern_5m_actual.png')
            save(Image.fromarray(np.uint8(fernview)).resize((size[0]*3,size[1]*3),Image.Resampling.NEAREST),'fern_5m_enlarged.png')
            entry['5m_projection_px']=list(size)
        if i==6:
            require(.929<=entry['roughness_min']<=entry['roughness_max']<=.973,'mass roughness 0.93–0.97')
            require(abs(entry['occlusion_min']-.35)<.004,'mass deepest gap AO about 0.35')
            require(np.all(ca==255),'mass is opaque edge to edge')
            require(np.max(np.abs(np.array(entry['rgb_mean'])-[66,78,48]))<.6,'mass mean 66,78,48')
            entry['rgb_target']=[66,78,48]
            darkest=cb[...,1]<=np.percentile(cb[...,1],1)
            entry['darkest_one_percent_rgb_mean']=cb[...,:3][darkest].mean(0).tolist()
            entry['ao_below_060_fraction']=float(np.mean(co[...,0]/255<.6))
            entry['ao_at_035_fraction']=float(np.mean(co[...,0]==round(.35*255)))
            entry['dark_green_below_65_fraction']=float(np.mean(cb[...,1]<65))
            entry['dark_green_below_80_fraction']=float(np.mean(cb[...,1]<80))
            require(np.max(np.abs(np.array(entry['darkest_one_percent_rgb_mean'])-[34,44,34]))<3,
                    'mass darkest pooled tissue near 34,44,34')
            require(np.all(cb[...,:3]>=[34,44,34]),'mass deepest pigment floor 34,44,34')
            entry['all_alpha_255']=bool(np.all(ca==255))
            entry['tile_seams']={key:tile_stats(arr) for key,arr in [('base',cb[...,:3]),('height',ch),('normal',n[sl]),('orm',co)]}
            for key,stat in entry['tile_seams'].items():
                require(max(stat['seam_to_interior_x'],stat['seam_to_interior_y'])<1.55,f'mass {key}: seam energy comparable to interior')
            lum=cb[...,:3].mean(-1);l=lum-lum.mean();var=np.mean(l*l)
            entry['repeat_correlations']={str(dx):float(np.mean(l*np.roll(l,dx,axis=1))/var) for dx in [64,128,192,256,384,512,690,1024]}
            save(np.tile(cb[...,:3],(2,2,1)),'mass_tiled_2x2.png')
            save(np.roll(cb[...,:3],(512,1024),(0,1)),'mass_offset.png')
            save(cb[126:638,200:968,:3],'mass_detail.png')
        metrics['regions'].append(entry)
    save(marked,'alpha_margins.png')
    for name,items in mip_panels.items():
        # A 4x4 grid: source columns, shrink rows, displayed at actual pixel size.
        byrow=[items[i*4+j] for j in range(4) for i in range(4)]
        save(sheet([p for p,l in byrow],[l for p,l in byrow],4,290,280),f'mips_{name}.jpg')
        for f in [2,4,8,16]:
            pictures=[np.array(Image.open(OUT/f'cluster_{i}_mip_{f:02d}_{name}.png')) for i in range(4)]
            save(np.concatenate(pictures,axis=1),f'mip_{f:02d}_{name}.png')
    left=lighting(b,n,o,[-.70,.42,.58]);right=lighting(b,n,o,[.70,-.42,.58])
    save(left,'lit_upper_left.png');save(right,'lit_lower_right.png')
    save(sheet([left,right],['Light upper left / no cast shadow','Light lower right / no cast shadow'],2,1024,1024),'relighting.jpg')
    save(sheet([composite(b[:512,:512]),left[:512,:512],right[:512,:512],composite(b[512:1024,:512])],
               ['Sun cluster / unlit','Sun / upper-left light','Sun / lower-right light','Fresh sun cluster / unlit'],2,512,512),'leaf_detail.jpg')
    save(sheet([composite(b[y:Y,x:X],(157,190,219)) for x,y,X,Y in [r['box'] for r in LAYOUT['cells'][:4]]],
               ['0 / sun / full round clump','1 / shade / broad, unequal groups','2 / sun / fresh tips, two brown leaves','3 / shade / long dense edge spray'],2,512,512),'clusters.png')
    save(sheet([composite(b[:1024,1024:1536]),composite(b[:1024,1536:]),left[:1024,1024:1536],left[:1024,1536:]],
               ['Moss / unlit','Fern / unlit','Moss / lit','Fern / lit'],4,384,768),'accessory_detail.jpg')
    # Every visible oak lamina has its own registered metric geometry.
    composition=json.loads((ROOT/'source/composition.json').read_text())
    leafids=np.array(Image.open(ROOT/'source/detail_leaf_ids.png'))
    metrics['leaf_geometry']=[]
    exposed=[]
    for ri,record in enumerate(composition['composition']):
        region=ri if ri<4 else 6
        x,y,X,Y=LAYOUT['cells'][region]['box']
        shoots=record['shoots'];leaves=[v for q in shoots for v in q['leaves']+q.get('supporting_leaves',[])]
        lens=[v['length_mm'] for v in leaves];widths=[v['width_mm'] for v in leaves]
        tilts=[v['tilt_degrees'] for v in leaves];diameters=[q['diameter_mm'] for q in shoots]
        require(min(lens)>=80 and max(lens)<=120,f'region {region}: all oak blades 80–120 mm long')
        require(min(widths)>=40 and max(widths)<=60,f'region {region}: all oak blades 40–60 mm wide')
        require(min(tilts)>=20 and max(tilts)<=50,f'region {region}: every blade tilted 20–50 degrees')
        require(all(6<=q['leaf_count']<=9 for q in shoots),f'region {region}: six to nine terminal leaves per shoot')
        require(min(diameters)>=300 and max(diameters)<=500,f'region {region}: projected rosettes 30–50 cm across')
        if ri<4:require(3<=len(shoots)<=6,f'cluster {ri}: three to six overlapping rosettes')
        ids=leafids[y:Y,x:X];z=h[y:Y,x:X].astype(float)*RANGE_MM/65535
        pix=record['physical_mm_per_pixel'];errs=[];slopes=[];probe_rows=[]
        boxes=ndi.find_objects(ids)
        # Independent plane fit to the DELIVERED height, eroding boundaries to
        # exclude the genuine discontinuity where one leaf covers another.
        for leaf in leaves:
            if leaf['id']>len(boxes) or boxes[leaf['id']-1] is None:continue
            by,bx=boxes[leaf['id']-1];x0,x1=bx.start,bx.stop;y0,y1=by.start,by.stop
            if (y1-y0)*(x1-x0)<24:continue
            interior=ndi.binary_erosion(ids[y0:y1,x0:x1]==leaf['id'],iterations=3)
            yy,xx=np.nonzero(interior)
            if len(xx)<18:continue
            mat=np.stack([(xx+x0)*pix,(yy+y0)*pix,np.ones_like(xx)],1)
            fit=np.linalg.lstsq(mat,z[yy+y0,xx+x0],rcond=None)[0]
            slope=np.degrees(np.arctan(np.hypot(fit[0],fit[1])))
            errs.append(abs(slope-leaf['tilt_degrees']));slopes.append(slope)
            if len(probe_rows)<6:probe_rows.append(dict(id=leaf['id'],authored_tilt=leaf['tilt_degrees'],height_fitted_tilt=float(slope),interior_pixels=len(xx)))
        require(len(errs)>10,f'region {region}: enough visible whole-leaf interiors to measure tilt')
        require(np.percentile(errs,95)<4,f'region {region}: delivered leaf slopes within 4 degrees at 95th percentile')
        metrics['leaf_geometry'].append(dict(region=region,shoots=len(shoots),leaves=len(leaves),
            terminal_leaves=sum(len(q['leaves']) for q in shoots),supporting_leaves=sum(len(q.get('supporting_leaves',[])) for q in shoots),
            painted_lengths_mm=[min(lens),max(lens)],widths_mm=[min(widths),max(widths)],
            sloped_surface_lengths_mm=[min(v['surface_length_mm'] for v in leaves),max(v['surface_length_mm'] for v in leaves)],
            tip_rise_mm=[min(v['length_mm']*np.tan(np.deg2rad(v['tilt_degrees'])) for v in leaves),max(v['length_mm']*np.tan(np.deg2rad(v['tilt_degrees'])) for v in leaves)],
            projected_lengths_mm=[min(v['projected_length_mm'] for v in leaves),max(v['projected_length_mm'] for v in leaves)],
            rosette_diameters_mm=[min(diameters),max(diameters)],tilt_degrees=[min(tilts),max(tilts)],
            measured_visible_leaf_count=len(errs),height_slope_error_p95_degrees=float(np.percentile(errs,95)),
            height_slope_range_degrees=[float(min(slopes)),float(max(slopes))],probes=probe_rows))
        topids=[leaf['id'] for leaf in leaves if leaf['height_center_mm']>=100 and leaf['kind']==2]
        top=np.isin(ids,topids)&(b[y:Y,x:X,3]>=128)
        exposed.append(b[y:Y,x:X,:3][top].mean(0))
        if ri==4:
            deepids=[leaf['id'] for leaf in leaves if leaf['height_center_mm']<=60]
            deep=np.isin(ids,deepids)
            metrics['mass_depth_tones']=dict(deep_leaf_rgb=b[y:Y,x:X,:3][deep].mean(0).tolist(),
                top_leaf_rgb=exposed[-1].tolist(),deep_leaf_ao_mean=float(o[y:Y,x:X,0][deep].mean()/255),
                top_leaf_ao_mean=float(o[y:Y,x:X,0][top].mean()/255),
                deepest_padding_fraction=record['deepest_interstice_fraction'])
            dc=np.array(metrics['mass_depth_tones']['deep_leaf_rgb']);tc=exposed[-1]
            require(dc[1]<tc[1]-20 and dc[2]/dc[1]>tc[2]/tc[1],'deeper mass leaves are darker and relatively bluer')
            require(record['deepest_interstice_fraction']<.01,'less than one percent deepest tissue requires periodic padding')
    metrics['ecotype_tones']=dict(mass_top_rgb_mean=exposed[-1].tolist(),clusters=[])
    for i,v in enumerate(exposed[:4]):
        mean=np.array(metrics['regions'][i]['rgb_mean'])
        metrics['ecotype_tones']['clusters'].append(dict(top_rgb_mean=v.tolist(),difference_from_mass_top=(v-exposed[-1]).tolist()))
        if i in [1,3]:
            require(np.max(np.abs(mean-exposed[-1]))<7,f'cluster {i}: shade mean matches mass upper leaves within 7 RGB levels')
        else:
            require(np.all(mean[:2]-exposed[-1][:2]>25),f'cluster {i}: sun leaves lighter than interior upper leaves')
    sun=np.mean([metrics['regions'][i]['rgb_mean'] for i in [0,2]],axis=0)
    shade=np.mean([metrics['regions'][i]['rgb_mean'] for i in [1,3]],axis=0)
    require(shade[2]/shade[1]>sun[2]/sun[1] and shade[0]/shade[1]<sun[0]/sun[1],
            'shade leaves relatively bluer and less yellow than sun leaves')
    fresh_mean=np.array(metrics['regions'][2]['fresh_rgb_mean'])
    require(all(fresh_mean[1]>v[1]+8 for v in exposed[:4]),'cell 2 fresh growth brighter than other exposed oak leaves')
    fresh_tips=np.array(metrics['regions'][2]['fresh_rgb_p95'])
    require(all(np.all(fresh_tips>metrics['regions'][i]['mature_rgb_max']) for i in [0,2]),
            'cell 2 fresh tips are the brightest oak yellow-green')
    pools=composition['composition'][-1]['hollows']
    require(all(50<=v['diameter_mm']<=150 for v in pools),'pooled hollows authored 5–15 cm across')
    require(120<=RANGE_MM<=160,'height encoding uses requested 120–160 mm range')
    mass30=srgb(resize(linear(b[1024:,:,:3]),(154,77)))
    low=ndi.gaussian_filter(mass30[...,1],.6,mode='wrap')
    metrics['mass_green_std_at_30m']=float(low.std())
    require(low.std()>3,'mass retains leaf-group contrast after 30 m filtering')
    # Source probes and delivered geometry side by side at real texture scale.
    save(sheet([Image.open(ROOT/'source/rounded_oak_leaves_round3_generated.png'),
        composite(b[:512,:512]),h[:512,:512]/257,n[:512,:512]],
        ['Round 3 rounded oval source','Metric overlapping shoots','Tilted leaf height, 160 mm range','Normals from saved height'],2,640,640),'source_scale_probes.jpg')
    fern=json.loads((ROOT/'source/fern_composition.json').read_text())
    metrics['fern_total_frond_length_mm']=[r['frond_length_mm'] for r in fern['blades']]
    blade_lengths=[r['blade_length_mm'] for r in fern['blades']]
    metrics['fern_blade_length_mm']=blade_lengths
    require(min(blade_lengths)>=300 and max(blade_lengths)<=600,'fern leafy blades 30–60 cm; complete petioles separately recorded')
    fy,fx=np.nonzero(b[:1024,1536:,3]>=128)
    fw=(fx.max()-fx.min()+1)*.5/512;fh=(fy.max()-fy.min()+1)/1024
    metrics['fern_tuft_metres']=dict(width=float(fw),height=float(fh))
    require(.43<=fw<=.477 and .78<=fh<=.83,'fern fills strip: about 0.5 m wide and 0.8 m tall with margins')
    require(fern['nonzero_alpha_outside_allowed_before_finalization']==0,'fern silhouette fits margins before any final gutter clearing')
    reference=json.loads((ROOT/'source/round2_accessory_reference.json').read_text())
    for name,x0,x1 in [('moss',1024,1536),('fern',1536,2048)]:
        for key,arr in [('base',b),('orm',o)]:
            digest=hashlib.sha256(arr[:1024,x0:x1].tobytes()).hexdigest()
            require(digest==reference[name][key],f'{name}: round-2 {key} unchanged byte-for-byte')
    preserved=json.loads((ROOT/'source/round3_preservation_reference.json').read_text())
    metrics['coverage_vs_previous_rounds']=[]
    for i,entry in enumerate(metrics['regions'][:4]):
        old=preserved['cluster_baseline'][i]
        comparisons=[]
        for q in entry['mip_coverage']:
            previous=preserved['round2_coverage_reference']['convex_percent_by_shrink'][str(q['shrink'])][i]
            delta=q['alpha_vs_fixed_convex_outline']*100-previous
            comparisons.append(dict(shrink=q['shrink'],round2_convex_percent=previous,round4_minus_round2_percentage_points=delta))
        require(min(q['round4_minus_round2_percentage_points'] for q in comparisons)>-5,
                f'cluster {i}: every shrink within five percentage points of round-2 coverage or higher')
        metrics['coverage_vs_previous_rounds'].append(dict(cell=i,
            round3_occupied_cell_fraction=old['occupied_cell_fraction'],round4_occupied_cell_fraction=entry['alpha_cut_coverage'],
            occupied_area_multiplier=entry['alpha_cut_coverage']/old['occupied_cell_fraction'],mips=comparisons))
    metrics['round3_preservation']={}
    for name,record in preserved['regions'].items():
        x,y,X,Y=record['box'];metrics['round3_preservation'][name]={}
        for key,arr in [('base',b),('height',h.astype(np.uint16)),('normal',n),('orm',o)]:
            digest=hashlib.sha256(arr[y:Y,x:X].tobytes()).hexdigest()
            unchanged=digest==record['maps'][key]
            expected_unchanged=name!='mass' or key in ['height','normal']
            metrics['round3_preservation'][name][key]=dict(sha256=digest,byte_identical=unchanged,expected_unchanged=expected_unchanged)
            if expected_unchanged:
                require(unchanged,f'{name}: round-3 {key} pixel bytes unchanged')
    baseline=json.loads((ROOT/'source/round4_preservation_reference.json').read_text())
    def array_hash(arr):return hashlib.sha256(arr.tobytes()).hexdigest()
    current=dict(base_alpha=array_hash(b[...,3]),height=array_hash(h.astype(np.uint16)),normal=array_hash(n),
        orm_roughness_metalness=array_hash(o[...,1:]),cards_orm=array_hash(o[:1024,:1024]))
    for key,arr in [('base',b),('height',h.astype(np.uint16)),('normal',n),('orm',o)]:
        current['accessories_'+key]=array_hash(arr[:1024,1024:])
    fixed=(b[:1024,:1024,3]>=128)&np.isin(kinds[:1024,:1024],[1,6])
    current['card_twigs_and_brown_rgb']=array_hash(b[:1024,:1024,:3][fixed])
    metrics['round4_preservation']={}
    for key,digest in current.items():
        equal=digest==baseline['pixel_hashes'][key]
        metrics['round4_preservation'][key]=dict(sha256=digest,byte_identical=equal)
        require(equal,f'round-4 {key} pixel bytes unchanged')
    for path,expected in baseline['file_hashes'].items():
        if path in ['oak_leaves_base.png','oak_leaves_orm.png']:continue
        digest=hashlib.sha256((ROOT/path).read_bytes()).hexdigest()
        metrics['round4_preservation'][path]=dict(sha256=digest,byte_identical=digest==expected)
        require(digest==expected,f'round-4 {path} file bytes unchanged')
    def geometry(value):
        if isinstance(value,dict):return {k:geometry(v) for k,v in value.items() if k!='color'}
        if isinstance(value,list):return [geometry(v) for v in value]
        return value
    digest=hashlib.sha256(json.dumps(geometry(composition['composition']),sort_keys=True).encode()).hexdigest()
    metrics['round4_preservation']['composition_geometry']=dict(sha256=digest,byte_identical=digest==baseline['geometry_sha256'])
    require(digest==baseline['geometry_sha256'],'round-4 every lamina, placement, tilt, hollow and support unchanged')
    for i,r in enumerate(metrics['regions'][:4]):
        require(r['mip_coverage']==baseline['mip_coverage'][i],f'cluster {i}: every coverage/connectivity measurement identical to round 4')
    old=baseline['mass_baseline'];new=metrics['regions'][6]
    metrics['mass_pool_area_change']=dict(before=old,after={k:new[k] for k in old})
    require(new['ao_below_060_fraction']>old['ao_below_060_fraction']+.15,'mass pooled AO below 0.60 expanded by more than 15 percentage points')
    require(new['dark_green_below_65_fraction']>.20,'mass cool deep pigment occupies more than 20 percent of its area')
    metrics['purpose_test']=purpose(b,n,o)
    for i,p in enumerate(metrics['purpose_test']['cards']):
        require(p['cell'] in ([0,2] if p['role']=='sun_top' else [1,3]),f'purpose card {i} uses the specified ecotype for its placement')
    for name,measure in metrics['purpose_test']['measurements'].items():
        require(measure['interior_opaque'],name+': shell remains opaque')
        require(measure['sun_to_shade_luminance_ratio']>1.15,name+': sun tops remain distinct from shade rims at 30 m')
        require(measure['sun_to_interior_luminance_ratio']>1.35,name+': top-to-interior value separation survives 30 m filtering')
    require(metrics['purpose_test']['measurements']['backlit']['cards_core_direct_sun_max']==0,'backlit visible core receives sky only; no direct sun')
    metrics['outline_definitions']=outline_data
    metrics['passed']=not failures;metrics['failures']=failures
    (OUT/'metrics.json').write_text(json.dumps(metrics,indent=2)+'\n')
    print(json.dumps(dict(passed=not failures,failures=failures,regions=[dict(name=r['name'],rgb_mean=r['rgb_mean'],
                    roughness=[r['roughness_min'],r['roughness_max']],ao=[r['occlusion_min'],r['occlusion_max']]) for r in metrics['regions']]),indent=2))
    if failures:raise SystemExit(1)


if __name__=='__main__':main()
