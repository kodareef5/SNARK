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
RANGE_MM=200.0


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
    if i<4:m[-12:,248:264]=False
    elif i in [4,5]:m[:12,12:w-12]=False
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
    placements=[dict(center_m=[p[0]*1.6,p[1]*1.524],cell=i%4,shortening=float(rng.uniform(.58,.96)),
                     angle=float(rng.uniform(-np.pi,np.pi))) for i,p in enumerate(positions)]
    cells=[0,2,0,1,0,2,3,1,3,1,3,1,2,0]
    for p,cell in zip(placements,cells):
        # The twig attaches inward; leaf tips reach outward around the rim.
        x,y=p['center_m']
        p['angle']=float(np.arctan2(x-2.4,1.6-y)+rng.uniform(-.18,.18))
        p['cell']=cell
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
        ppm=(viewport/2)/distance;size=(round(ppm*4.8),round(ppm*3.2));w,h=size
        y,x=np.mgrid[:h,:w];x=(x+.5)*4.8/w;y=(y+.5)*3.2/h
        u=(x-2.4)/1.8;v=(y-1.60)/1.05;r2=u*u+v*v
        shell=r2<=1
        macro=np.stack([u*.85,-v*.85,np.sqrt(np.maximum(.01,1-r2))],-1)
        macro/=np.linalg.norm(macro,axis=-1,keepdims=True)
        mass=mip(base[1024:],normal[1024:],orm[1024:],(round(ppm*6.4),round(ppm*3.2)))
        uv=[y/3.2*mass['alpha'].shape[0]-.5,x/6.4*mass['alpha'].shape[1]-.5]
        plain={key:sample(val,uv,True) for key,val in mass.items()}
        covered={key:val.copy() for key,val in plain.items()}
        visible=shell.copy();card_index=np.full((h,w),-1,int)
        for k,p in enumerate(placements if card_limit is None else placements[:card_limit]):
            cell=LAYOUT['cells'][p['cell']];x0,y0,x1,y1=cell['box']
            mw=max(2,round(ppm*1.2));mh=max(2,round(ppm*1.2*p['shortening']))
            card=mip(base[y0:y1,x0:x1],normal[y0:y1,x0:x1],orm[y0:y1,x0:x1],(mw,mh))
            dx=x-p['center_m'][0];dy=y-p['center_m'][1]
            c=np.cos(p['angle']);s=np.sin(p['angle'])
            a=(dx*c+dy*s)/1.2+.5;b=(-dx*s+dy*c)/(1.2*p['shortening'])+.5
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
                core=(r2<.30)&alpha
                measure[kind+'_core_rgb_mean']=col[core].mean(0).tolist()
                measure[kind+'_core_direct_sun_max']=float(direct[core].max())
                if kind=='cards':
                    cell_index=np.array([p['cell'] for p in placements])[np.maximum(card_index,0)]
                    for habitat,cells in [('sun',[0,2]),('shade',[1,3])]:
                        selected=(card_index>=0)&np.isin(cell_index,cells)
                        measure[habitat+'_card_rgb_mean']=col[selected].mean(0).tolist()
                    measure['sun_minus_shade_rgb']=(np.array(measure['sun_card_rgb_mean'])-
                        measure['shade_card_rgb_mean']).tolist()
            core=(r2<.65)&(card_index>=0)
            difference=pictures['cards']-pictures['mass']
            measure['card_replacement_mean_absolute_rgb']=float(np.abs(difference[core]).mean())
            measure['card_replacement_mean_rgb']=difference[core].mean(0).tolist()
            measure['interior_opaque']=bool(np.all(visible[shell]))
            result[name]=dict(images=pictures,measurements=measure,size_px=list(size))
        return result
    results={d:render(d,1920) for d in [5,30,60]}
    screenshot_scale=render(30,1280)
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
            panels.append(im.resize((770,510),Image.Resampling.NEAREST))
            labels.append(f'{name}: {kind}, 30 m, 154 x 102 px enlarged x5')
    save(sheet(panels,labels,2,770,510),'purpose_30m_both_lights.png')
    panels=[];labels=[]
    for name in lights:
        for kind in ['mass','cards']:
            im=Image.fromarray(np.uint8(sparse[name]['images'][kind]))
            panels.append(im.resize((770,510),Image.Resampling.NEAREST))
            labels.append(f'{name}: sparse {kind}, 30 m, enlargement x5')
    save(sheet(panels,labels,2,770,510),'purpose_30m_sparse_both_lights.png')
    # Reference scale registered from the 24 m F02 canopy in fig_lineup.
    # The painting has perspective; this is an explicit art-scale estimate.
    ref=Image.open(ROOT/'source/concept_fig_crop.png').convert('RGB')
    crop_box=(925,94,1114,220)
    size=results[30]['frontlit']['size_px']
    metric_ref=ref.resize(tuple(size),Image.Resampling.LANCZOS)
    save(metric_ref,'concept_fig_registered_30m.png')
    panels=[];labels=[]
    for name in lights:
        for title,pic in [('concept',metric_ref),('mass',Image.fromarray(np.uint8(results[30][name]['images']['mass']))),('cards',Image.fromarray(np.uint8(results[30][name]['images']['cards'])))]:
            panels.append(pic.resize((size[0]*5,size[1]*5),Image.Resampling.NEAREST))
            labels.append(f'{name} / {title} / 154 x 102 pixels at 30 m, enlarged 5x')
    save(sheet(panels,labels,3,770,510),'purpose_30m_concept_comparison.png')
    native=[metric_ref]+[Image.fromarray(np.uint8(results[30][name]['images']['cards'])) for name in lights]
    save(sheet(native,['Concept at registered scale','Sun behind viewer / 30 m','Sun high behind billow / 30 m'],3,230,150),'purpose_30m_actual.png')
    return dict(horizontal_fov_degrees=90,viewport_width_px=1920,focal_length_px=960,
                frame_metres=[4.8,3.2],billow_metres=[3.6,2.1],card_metres=1.2,
                projection_30m_px=[154,102],cluster_30m_px=38.4,engine_capture=False,
                lights=lights,cards=placements,geometric_horizon_clipping=True,
                concept_registration=dict(file='../../ref/concept/broadleaf/fig_lineup.png',crop_pixels=list(crop_box),
                    reference_crown_width_metres=24,reference_crown_width_pixels=945,pixels_per_metre=39.375,
                    crop_metres=[4.8,3.2],caveat='Approximate art-scale registration from F02 construction width; painting is not calibrated camera data.'),
                sparse_4_cards={name:sparse[name]["measurements"] for name in lights},
                measurements={name:results[30][name]['measurements'] for name in lights},
                screenshot_scale_1280={name:screenshot_scale[name]['measurements'] for name in lights},
                note='Per-card mip filtering, alpha cut 0.5, shared rounded macro normals plus rotated delivered detail normals. AO affects sky only; matte sky sheen uses ORM. No cast shadow, bounce, rim light, exposure adjustment or coverage boost.')


def geometry_checks(comp,ids,height,kinds,base,require):
    measurements=[];tops={}
    for record in comp['regions']:
        region=record['region']
        if region in [4,5]:
            require(record['main_count']==(12 if region==4 else 5),f'root strip {region}: specified main-strand count')
            di=[q['top_diameter_mm'] for q in record['paths']]
            require(min(di)>=5 and max(di)<=20,f'root strip {region}: 5--20 mm tops')
            measurements.append(dict(region=region,main_strands=record['main_count'],top_diameter_mm=[min(di),max(di)],
                                     length_mm=[min(q['length_mm'] for q in record['paths']),max(q['length_mm'] for q in record['paths'])]))
            continue
        x0,y0,x1,y1=LAYOUT['cells'][region]['box'];sl=np.s_[y0:y1,x0:x1]
        shoots=record['shoots'];leaves=[leaf for q in shoots for leaf in q.get('supporting_leaves',[])+q['leaves']]
        length=np.array([v['projected_length_mm'] for v in leaves]);tilts=np.array([v['tilt_degrees'] for v in leaves])
        require(min(length)>=128 and max(length)<=213,f'region {region}: leaves within declared 14--20 cm nominal variation')
        require(min(tilts)>=20 and max(tilts)<=50,f'region {region}: authored tilts 20--50 degrees')
        if region<4:require(4<=len(shoots)<=6,f'cluster {region}: four to six terminal rosettes')
        z=height[sl].astype(float)*RANGE_MM/65535;idmap=ids[sl];pix=record['physical_mm_per_pixel']
        boxes=ndi.find_objects(idmap);fits=[];errors=[];visible=[];probe=[]
        for leaf in leaves:
            ident=leaf['id']
            if ident>len(boxes) or boxes[ident-1] is None:continue
            by,bx=boxes[ident-1]
            if (bx.stop-bx.start)*(by.stop-by.start)>20000:continue # wrapped seam blade
            mask=ndi.binary_erosion(idmap[by,bx]==ident,iterations=4)
            y,x=np.nonzero(mask)
            if len(x)<30:continue
            X=np.stack([(x+bx.start)*pix,(y+by.start)*pix,np.ones(len(x))],1)
            # Reject tiny slivers that cannot constrain a two-dimensional plane.
            if min(np.std(X[:,0]),np.std(X[:,1]))<4:continue
            plane=np.linalg.lstsq(X,z[y+by.start,x+bx.start],rcond=None)[0]
            tilt=float(np.degrees(np.arctan(np.hypot(*plane[:2]))))
            fits.append(tilt);errors.append(abs(tilt-leaf['tilt_degrees']));visible.append(ident)
            if len(probe)<8:probe.append(dict(leaf_id=ident,author_tilt=leaf['tilt_degrees'],measured_tilt=tilt,interior_pixels=len(x)))
        require(len(fits)>15,f'region {region}: enough exposed leaf interiors to check slope')
        require(np.median(errors)<9 and np.percentile(errors,95)<23,f'region {region}: continuous leaf-height fit retains authored slopes (median error <9, p95 <23 degrees)')
        require(24<np.median(fits)<46,f'region {region}: delivered leaf interiors retain substantial tilt')
        upper_ids=[v['id'] for v in leaves if v['tier']==2 and v['kind']==2 and v['height_center_mm']>94]
        top=np.isin(idmap,upper_ids)&(base[sl][...,3]>=128)
        tops[str(region)]=base[sl][...,:3][top].mean(0).tolist()
        measurements.append(dict(region=region,shoot_count=len(shoots),leaf_count=len(leaves),
            projected_length_mm=[float(length.min()),float(length.max())],
            surface_length_mm=[min(v['surface_length_mm'] for v in leaves),max(v['surface_length_mm'] for v in leaves)],
            rosette_diameter_mm=[min(q['diameter_mm'] for q in shoots),max(q['diameter_mm'] for q in shoots)],
            authored_tilt_degrees=[float(tilts.min()),float(tilts.max())],measured_leaf_interiors=len(fits),
            measured_tilt_p10_p50_p90=np.percentile(fits,[10,50,90]).tolist(),
            fitted_error_p95_degrees=float(np.percentile(errors,95)),probes=probe,
            deepest_interstice_fraction=record.get('deepest_interstice_fraction',0)))
    
    require(max(np.max(np.abs(np.array(tops[str(i)])-[110,122,62])) for i in [0,2])<5,
            'sun cards: exposed mature tissue near 110/122/62')
    require(max(np.max(np.abs(np.array(tops[str(i)])-tops['6'])) for i in [1,3])<5,
            'shade cards and mass upper leaves agree within five RGB levels')
    require(np.max(np.abs(np.array(tops['6'])-[72,88,58]))<1,'mass upper tissue near 72/88/58')
    return dict(regions=measurements,exposed_upper_mature_leaf_means=tops)


def root_edge_width(alpha):
    """10--90% transitions across substantial root bodies, in native pixels.

    Distance to the cutout is not an edge-width metric at fine free tips:
    a subpixel tip may extend many pixels along its axis below the 0.5 cut.
    Horizontal cross sections of these near-vertical roots measure the actual
    transverse antialias band. Intersections and subpixel bodies are excluded.
    """
    widths=[]
    for row in alpha[10:-20:13].astype(float)/255:
        labels,count=ndi.label(row>=.9)
        for k in range(1,count+1):
            ix=np.flatnonzero(labels==k)
            if len(ix)<2:continue
            for direction,start in [(-1,int(ix[0])),(1,int(ix[-1]))]:
                profile=[]
                for step in range(9):
                    x=start+direction*step
                    if x<0 or x>=len(row):break
                    profile.append(row[x])
                    if row[x]<.025:break
                if len(profile)<3 or profile[-1]>.1:continue
                if any(profile[j+1]>profile[j]+.04 for j in range(len(profile)-1)):continue
                at=[]
                for level in [.9,.1]:
                    for j in range(len(profile)-1):
                        if profile[j]>=level>=profile[j+1]:
                            at.append(j+(profile[j]-level)/max(1e-6,profile[j]-profile[j+1]));break
                if len(at)==2:widths.append(at[1]-at[0])
    return dict(samples=len(widths),median_px=float(np.median(widths)),p95_px=float(np.percentile(widths,95)))


def main():
    OUT.mkdir(exist_ok=True)
    files={k:ROOT/f'fig_leaves_{k}.png' for k in ['base','height','normal','orm']}
    images={k:Image.open(f) for k,f in files.items()}
    b,h,n,o=[np.asarray(images[k]) for k in ['base','height','normal','orm']]
    kinds=np.asarray(Image.open(ROOT/'source/material_ids.png'))
    ids=np.asarray(Image.open(ROOT/'source/leaf_ids.png'))
    comp=json.loads((ROOT/'source/composition.json').read_text())
    metrics=dict(passed=False,height_range_mm=RANGE_MM,files={},regions=[],assertions=[])
    failures=[]
    def require(ok,msg):
        metrics['assertions'].append(dict(check=msg,passed=bool(ok)))
        if not ok:failures.append(msg)
    for key,path in files.items():
        header=path.read_bytes()[24:26]
        metrics['files'][key]=dict(path=path.name,size=images[key].size,mode=images[key].mode,
            bit_depth=header[0],png_color_type=header[1],srgb='srgb' in images[key].info,
            sha256=hashlib.sha256(path.read_bytes()).hexdigest())
        require(images[key].size==(2048,2048),key+' 2048 x 2048')
        require(header[0]==(16 if key=='height' else 8),key+' bit depth')
        require(header[1]==({'base':6,'height':0,'normal':2,'orm':2}[key]),key+' PNG channel format')
    require('srgb' in images['base'].info,'base tagged sRGB')
    require(all('srgb' not in images[k].info for k in ['height','normal','orm']),'data maps untagged linear')
    require(np.all(o[...,2]==0),'metalness zero everywhere')
    require(comp['height_range_mm']==RANGE_MM,'independent height range agrees with builder manifest')
    vis=b[...,3]>=128
    panels=[composite(b,(70,73,70)),np.where(vis[...,None],np.repeat((h/257)[...,None],3,-1),70),np.where(vis[...,None],n,70),np.where(vis[...,None],o,70)]
    review=composite(b,(128,128,128),cut=False)
    save(Image.fromarray(np.uint8(review)).resize((1536,1536),Image.Resampling.LANCZOS),'assembly_review.jpg')
    save(review[:1024,:1024],'clusters_review.png')
    save(sheet(panels,['Base / sRGB RGBA','Height / 16 bit / 0--200 mm','OpenGL normal / metric scale','ORM / linear RGB'],2,768,768),'layers.jpg')
    save(b[...,3],'alpha.png')
    guide=np.array(Image.open(ROOT/'guide/layout.png').convert('RGB'))
    a=b[...,3:4]/255.;overlay=b[...,:3]*a+guide*(1-a)
    save(overlay,'base_over_layout.png')
    marked=composite(b,(70,73,70));mips={x:[] for x in ['grey','sky']}
    for i,r in enumerate(LAYOUT['cells']):
        x0,y0,x1,y1=r['box'];sl=np.s_[y0:y1,x0:x1]
        cb,co,ch=b[sl],o[sl],h[sl];ca=cb[...,3];mask=ca>=128
        forbidden=margins_for(i,mask.shape);bad=int(np.count_nonzero(ca[forbidden]))
        require(bad==0,f'region {i}: zero nonzero alpha in forbidden margins')
        marked[sl][forbidden]=marked[sl][forbidden]*.25+[110,28,24]
        entry=dict(region=i,name=r['what'],box=r['box'],alpha_nonzero_in_margins=bad,
            alpha_cut_cell_coverage=float(mask.mean()),rgb_mean=cb[...,:3][mask].mean(0).tolist(),
            rgb_min=cb[...,:3][mask].min(0).tolist(),rgb_max=cb[...,:3][mask].max(0).tolist(),
            roughness_range=[float(co[...,1][mask].min()/255),float(co[...,1][mask].max()/255)],
            roughness_mean=float(co[...,1][mask].mean()/255),
            occlusion_range=[float(co[...,0][mask].min()/255),float(co[...,0][mask].max()/255)],
            height_used_mm=[float(ch[mask].min()*RANGE_MM/65535),float(ch[mask].max()*RANGE_MM/65535)],
            normal_against_height=normal_check(h,n,r))
        require(entry['normal_against_height']['max_degrees']<.5,f'region {i}: normal-height error below 0.5 degree')
        if i<6:
            _,ix=ndi.distance_transform_edt(~mask,return_indices=True)
            diff=np.abs(cb[...,:3].astype(int)-cb[...,:3][tuple(ix)].astype(int))
            entry['transparent_padding_max_error']=int(diff[~mask].max())
            require(entry['transparent_padding_max_error']==0,f'region {i}: full-cell RGB padding has no fringe')
            dist=ndi.distance_transform_edt(~mask);edge=(ca>0)&(ca<255)
            entry['fractional_alpha_pixels']=int(edge.sum());entry['alpha_levels']=len(np.unique(ca))
            entry['soft_fringe_outward_p95_px']=float(np.percentile(dist[edge],95))
            require(entry['alpha_levels']>100,f'region {i}: soft antialiased edge')
            
            if i<4:require(entry['soft_fringe_outward_p95_px']<=2.01,f'region {i}: soft fringe within two pixels at p95')
        if i<4:
            hull,env=outline(mask);coverage=[]
            leafy=mask & np.isin(kinds[sl],[2,5,6,7])
            ly,lx=np.nonzero(leafy)
            entry['leaf_bounds_px']=[int(lx.min()),int(ly.min()),int(lx.max()+1),int(ly.max()+1)]
            entry['leaf_margin_px']=[int(lx.min()),int(ly.min()),int(511-lx.max()),int(511-ly.max())]
            require(max(entry['leaf_margin_px'][:3])<=28,f'cluster {i}: leaves reach within 28 px of left, top and right')
            require(mask.mean()>=(.48 if i<3 else .35),f'cluster {i}: substantial occupied area of full card')
            eigenvalues=np.linalg.eigvalsh(np.cov(np.stack([lx,ly])))
            entry['leaf_body_principal_axis_ratio']=float(np.sqrt(eigenvalues[1]/eigenvalues[0]))
            if i==3:require(entry['leaf_body_principal_axis_ratio']>1.7,'cluster 3: elongated narrow diagonal spray')
            foot=np.flatnonzero(mask[-1])
            require(len(foot)>0 and abs(float(foot.mean())-256)<4,f'cluster {i}: twig enters at bottom centre')
            holes=ndi.binary_fill_holes(mask)&~mask
            hole_ids,_=ndi.label(holes);hole_sizes=np.bincount(hole_ids.ravel())[1:]
            entry['largest_internal_gap_px']=int(hole_sizes.max()) if len(hole_sizes) else 0
            entry['largest_internal_gap_equivalent_diameter_mm']=float(2*np.sqrt(entry['largest_internal_gap_px']/np.pi)*1200/512)
            require(entry['largest_internal_gap_equivalent_diameter_mm']<180,f'cluster {i}: internal openings smaller than an 18 cm leaf')
            for factor in [1,2,4,8,16]:
                size=(512//factor,512//factor);aa=resize(ca/255.,size);keep=aa>=.5
                hullsmall=resize(hull,size);envsmall=resize(env,size)
                lab,count=ndi.label(keep,np.ones((3,3)));hist=np.bincount(lab.ravel());hist[0]=0
                coverage.append(dict(shrink=factor,size_px=size,solid_pixels=int(keep.sum()),
                    against_fixed_convex_outline=float(keep.sum()/hullsmall.sum()),
                    against_fixed_scalloped_outline=float(keep.sum()/envsmall.sum()),
                    occupied_cell_fraction=float(keep.mean()),
                    native_area_retained=float(keep.sum()*factor*factor/mask.sum()),
                    largest_component_fraction=float(hist.max()/keep.sum())))
                if factor>1:
                    for name,bg in [('grey',(128,128,128)),('sky',(199,219,231))]:
                        pic=composite(cb,bg,size=size);save(pic,f'cluster_{i}_mip_{factor:02d}_{name}.png')
                        mips[name].append((pic,f'Cluster {i} / 1:{factor} / {size[0]} px'))
            entry['outline_coverage']=coverage
            require(min(v['against_fixed_scalloped_outline'] for v in coverage)>.88,f'cluster {i}: dense scalloped outline through sixteenth mip')
            require(all(.75<=v['against_fixed_convex_outline']<=.85 for v in coverage),f'cluster {i}: convex outline coverage 75--85 percent at every shrink')
            require(all(v['largest_component_fraction']>.98 for v in coverage),f'cluster {i}: connected at every shrink through sixteenth')
            target=[110,122,62] if i in [0,2] else [72,88,58]
            entry['habitat']='sun' if i in [0,2] else 'shade'
            require(np.max(np.abs(np.array(entry['rgb_mean'])-target))<1,f'cluster {i}: {entry["habitat"]} mean {target}')
            require(entry['roughness_range'][0]>=.929 and entry['roughness_range'][1]<=.973,f'cluster {i}: matte 0.93--0.97')
            require(entry['occlusion_range'][0]>=.749,f'cluster {i}: AO at least 0.75')
            for kind,title in [(5,'fresh'),(6,'old'),(7,'underside')]:
                sel=(kinds[sl]==kind)&mask
                entry[title+'_fraction']=float(sel.sum()/mask.sum())
                entry[title+'_rgb_max']=cb[...,:3][sel].max(0).tolist() if sel.any() else [0,0,0]
                entry[title+'_rgb_mean']=cb[...,:3][sel].mean(0).tolist() if sel.any() else [0,0,0]
            require(np.all(np.array(entry['underside_rgb_max'])<=[115,125,90]),f'cluster {i}: underside brightness capped')
            require(entry['underside_fraction']<.075,f'cluster {i}: turned leaves occasional')
            if i==2:
                require(.01<=entry['fresh_fraction']<=.08,'cluster 2: localized fresh tips occupy 1--8 percent')
                require(0<entry['old_fraction']<.025,'cluster 2: one or two yellowed leaves remain visible')
                old=[leaf for q in comp['regions'][i]['shoots'] for leaf in q['leaves'] if leaf['kind']==6]
                require(1<=len(old)<=2,'cluster 2: one or two authored yellowed leaves')
                fresh=mask&(kinds[sl]==5)
                entry['fresh_rgb_p90']=np.percentile(cb[...,:3][fresh],90,axis=0).tolist()
                require(np.max(np.abs(np.array(entry['fresh_rgb_p90'])-[150,158,72]))<8,
                        'cluster 2: fresh tips approach 150/158/72')
                mature=b[...,:3][(kinds==2)&vis]
                require(cb[...,:3][fresh].mean(0)[:2].min()>np.percentile(mature,99,axis=0)[:2].max(),
                        'cluster 2: fresh growth brighter than mature atlas foliage')
            if i in [0,2]:
                mature=mask&(kinds[sl]==2)
                entry['mature_bright_rgb_p99']=np.percentile(cb[...,:3][mature],99,axis=0).tolist()
                require(entry['mature_bright_rgb_p99'][0]>130 and entry['mature_bright_rgb_p99'][1]>140,
                        f'cluster {i}: mature sun tips retain a bright warm range')
            entry['bright_neutral_fleck_fraction']=float(np.mean((cb[...,0][mask]>120)&(cb[...,2][mask]>100)))
            require(entry['bright_neutral_fleck_fraction']==0,f'cluster {i}: no pale neutral flecks')
        elif i<6:
            entry['root_transverse_edge_10_90']=root_edge_width(ca)
            require(entry['root_transverse_edge_10_90']['samples']>100,f'root strip {i}: enough isolated edge probes')
            require(entry['root_transverse_edge_10_90']['p95_px']<=2.1,f'root strip {i}: transverse edge softness one to two pixels')
            require(abs(entry['roughness_mean']-.90)<.003,f'root strip {i}: roughness 0.9')
            size=(64,128);aa=resize(ca/255.,size)
            entry['15m_projection_px']=size;entry['15m_opaque_pixels']=int((aa>=.5).sum())
            entry['15m_rows_with_roots']=int(np.any(aa>=.5,axis=1).sum())
            require(entry['15m_rows_with_roots']>64,f'root strip {i}: body survives 15 m filtering')
            traces=[]
            for root in comp['regions'][i]['paths']:
                pts=np.array(root['points_px']);pts=pts[:round(len(pts)*.6)]
                present=[]
                for x,y in pts:
                    yy=int(np.clip(y/8,0,127));xx=int(np.clip(x/8,1,62))
                    present.append(bool(np.any(aa[yy,xx-1:xx+2]>=.5)))
                traces.append(dict(root_id=root['id'],first_60_percent_body_survival=float(np.mean(present))))
            entry['15m_strand_traces']=traces
            substantial=sum(t['first_60_percent_body_survival']>=.9 for t in traces)
            require(substantial>=(8 if i==4 else 3),f'root strip {i}: main bodies remain continuous at 15 m')
            for name,bg in [('grey',(128,128,128)),('sky',(199,219,231))]:
                pic=composite(cb,bg,size=size);save(pic,f'roots_{i-3}_15m_{name}.png')
                save(Image.fromarray(pic.astype(np.uint8)).resize((384,768),Image.Resampling.NEAREST),f'roots_{i-3}_15m_{name}_enlarged.png')
        else:
            entry['all_alpha_255']=bool(np.all(ca==255));require(entry['all_alpha_255'],'mass fully opaque')
            require(np.max(np.abs(np.array(entry['rgb_mean'])-[56,70,44]))<.6,'mass mean 56/70/44')
            require(entry['roughness_range'][0]>=.929 and entry['roughness_range'][1]<=.973,'mass roughness 0.93--0.97')
            require(abs(entry['occlusion_range'][0]-.35)<.006,'mass AO reaches 0.35')
            ao=co[...,0]/255.;pooled=ndi.gaussian_filter(ao,11,mode='wrap')
            entry['ao_below_060_fraction']=float(np.mean(ao<.60))
            entry['ao_below_075_fraction']=float(np.mean(ao<.75))
            entry['pooled_ao_below_070_fraction']=float(np.mean(pooled<.70))
            before=json.loads((ROOT/'source/round2_preservation_reference.json').read_text())['mass_baseline']
            for key in ['ao_below_060_fraction','pooled_ao_below_070_fraction']:
                require(entry[key]>before[key]+.10,f'mass {key}: pooled hollows expand by more than ten percentage points')
            dark=cb[...,1]<=np.percentile(cb[...,1],1)
            entry['deepest_one_percent_rgb_mean']=cb[...,:3][dark].mean(0).tolist()
            require(np.max(np.abs(np.array(entry['deepest_one_percent_rgb_mean'])-[28,38,30]))<5,
                    'mass deepest pigment near cool 28/38/30')
            require(entry['deepest_one_percent_rgb_mean'][2]/entry['deepest_one_percent_rgb_mean'][1]>.70,
                    'mass deep foliage is bluer than exposed shade leaves')
            entry['blue_dominant_fraction']=float(np.mean(cb[...,2]>cb[...,1]))
            require(entry['blue_dominant_fraction']<.001,'mass cool foliage stays green without amplified blue flecks')
            entry['tile_seams']={key:tile_stats(arr) for key,arr in [('base',cb[...,:3]),('height',ch),('normal',n[sl]),('orm',co)]}
            for key,stat in entry['tile_seams'].items():
                require(max(stat['seam_to_interior_x'],stat['seam_to_interior_y'])<1.55,f'mass {key}: seam no stronger than interior')
            lum=cb[...,:3].mean(-1);lum-=lum.mean();var=np.mean(lum*lum)
            entry['repeat_correlations']={str(dx):float(np.mean(lum*np.roll(lum,dx,1))/var) for dx in [64,128,256,384,512,768,1024]}
            require(max(abs(v) for v in entry['repeat_correlations'].values())<.30,'mass no strong sub-period repeat')
            small=resize(cb[...,:3],(205,102));entry['30m_green_stddev']=float(small[...,1].std())
            save(np.tile(cb[...,:3],(2,2,1)),'mass_tiled_2x2.png');save(np.roll(cb[...,:3],(512,1024),(0,1)),'mass_offset.png')
        metrics['regions'].append(entry)
    save(marked,'alpha_margins.png')
    for name,items in mips.items():
        byrow=[items[i*4+j] for j in range(4) for i in range(4)]
        save(sheet([p for p,l in byrow],[l for p,l in byrow],4,290,280),f'mips_{name}.jpg')
        for factor in [2,4,8,16]:
            pics=[np.asarray(Image.open(OUT/f'cluster_{i}_mip_{factor:02d}_{name}.png')) for i in range(4)]
            save(np.concatenate(pics,axis=1),f'mip_{factor:02d}_{name}.png')
    left=lighting(b,n,o,[-.70,.42,.58]);right=lighting(b,n,o,[.70,-.42,.58])
    save(left,'lit_upper_left.png');save(right,'lit_lower_right.png')
    save(sheet([left,right],['Sun upper left','Sun lower right'],2,1024,1024),'relighting.jpg')
    save(sheet([composite(b[:512,:512]),left[:512,:512],right[:512,:512],composite(b[512:1024,:512])],
        ['Mature unlit','Mature / light upper left','Mature / light lower right','Fresh unlit'],2,512,512),'leaf_detail.jpg')
    save(sheet([composite(b[:1024,1024:1536]),composite(b[:1024,1536:]),left[:1024,1024:1536],left[:1024,1536:]],
        ['Dense roots unlit','Sparse roots unlit','Dense roots lit','Sparse roots lit'],4,384,768),'root_detail.jpg')
    save(sheet([composite(b[1024:,:]),left[1024:,:],right[1024:,:]],['Mass unlit','Mass upper-left sun','Mass lower-right sun'],1,1536,768),'mass_relief.jpg')
    metrics['geometry']=geometry_checks(comp,ids,h,kinds,b,require)
    preserved=json.loads((ROOT/'source/round1_preservation_reference.json').read_text())
    metrics['round1_preservation']={}
    for name,record in preserved['regions'].items():
        x,y,X,Y=record['box'];metrics['round1_preservation'][name]={}
        for key,arr in [('base',b),('height',h.astype('<u2')),('normal',n),('orm',o)]:
            if name=='mass' and key in ['base','orm']:continue # Round 3 explicitly revises these channels.
            digest=hashlib.sha256(arr[y:Y,x:X].tobytes()).hexdigest()
            same=digest==record['sha256'][key]
            metrics['round1_preservation'][name][key]=dict(sha256=digest,byte_identical=same)
            require(same,f'round-1 {name} {key}: protected pixels byte-identical including padding')
    metrics['cluster_area_growth']=[]
    for old,new in zip(preserved['cluster_baseline'],metrics['regions'][:4]):
        metrics['cluster_area_growth'].append(dict(cell=old['cell'],before=old['occupied_cell_fraction'],
            after=new['alpha_cut_cell_coverage'],multiplier=new['alpha_cut_cell_coverage']/old['occupied_cell_fraction']))
    baseline=json.loads((ROOT/'source/round2_preservation_reference.json').read_text())
    protected=dict(alpha=b[...,3],height=h.astype('<u2'),normal=n,roughness=o[...,1],metalness=o[...,2],
        card_occlusion=o[:1024,:1024,0],root_base=b[:1024,1024:],root_height=h[:1024,1024:].astype('<u2'),
        root_normal=n[:1024,1024:],root_orm=o[:1024,1024:],leaf_ids=ids.astype('<u2'),material_ids=kinds,
        twig_rgb=b[...,:3][kinds==1])
    metrics['round2_preservation']={}
    for name,arr in protected.items():
        digest=hashlib.sha256(arr.tobytes()).hexdigest();same=digest==baseline['protected'][name]
        metrics['round2_preservation'][name]=dict(sha256=digest,byte_identical=same)
        require(same,f'round-2 {name}: exact accepted pixels retained')
    for name,digest in baseline['unchanged_png_sha256'].items():
        require(metrics['files'][name]['sha256']==digest,f'round-2 {name}: entire PNG byte-identical')
    construction=[{k:v for k,v in r.items() if k!='habitat_palette'} for r in comp['regions']]
    digest=hashlib.sha256(json.dumps(construction,sort_keys=True,separators=(',',':')).encode()).hexdigest()
    require(digest==baseline['construction_sha256'],'round-2 every authored blade, root, height solve and layout unchanged')
    require(hashlib.sha256((ROOT/'guide/LAYOUT.json').read_bytes()).hexdigest()==baseline['layout_sha256'],
            'round-2 layout file byte-identical')
    metrics['purpose']=purpose(b,n,o)
    require(metrics['purpose']['measurements']['backlit']['cards_core_direct_sun_max']==0,'backlit visible core receives no direct sun')
    for light,measure in metrics['purpose']['measurements'].items():
        require(measure['sun_minus_shade_rgb'][1]>10,f'30 m {light}: sun/shade cards keep more than ten green levels of separation')
    metrics['passed']=not failures;metrics['failed_checks']=failures;metrics['assertion_count']=len(metrics['assertions'])
    (OUT/'metrics.json').write_text(json.dumps(metrics,indent=2)+'\n')
    print(json.dumps(dict(passed=metrics['passed'],assertions=len(metrics['assertions']),failures=failures),indent=2))
    if failures:raise AssertionError('; '.join(failures))


if __name__=='__main__':main()
