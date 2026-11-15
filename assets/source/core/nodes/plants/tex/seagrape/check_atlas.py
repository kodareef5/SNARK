#!/usr/bin/env python3
"""Independent atlas checks and review images; exits nonzero on failed requirements."""
from pathlib import Path
import hashlib
import json
import math

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage as nd

ROOT=Path(__file__).resolve().parent
CHECKS=ROOT/'checks'
SIZE=2048
BARK_X=1920
BACKGROUNDS={'dark':(42,44,43),'white':(255,255,255),'green':(76,111,65)}


def font(size):
    for path in ['/System/Library/Fonts/Supplemental/Arial.ttf','/Library/Fonts/Arial.ttf']:
        if Path(path).exists():return ImageFont.truetype(path,size)
    return ImageFont.load_default(size=size)


def composite(rgb,alpha,bg):
    a=np.asarray(alpha,dtype=np.float32)[...,None]/255
    return np.rint(np.asarray(rgb)*a+np.asarray(bg)*(1-a)).clip(0,255).astype(np.uint8)


def resize_channels(base,size):
    # Hardware-like independent RGB/alpha averaging; intentionally NOT premultiplied.
    rgb=np.array(Image.fromarray(base[...,:3]).resize((size,size),Image.Resampling.BOX))
    a=np.array(Image.fromarray(base[...,3]).resize((size,size),Image.Resampling.BOX))
    return rgb,a


def normals_independent(height,scale,range_mm,bark_metres):
    """Explicit finite differences independently implemented from delivered PNG."""
    out=np.zeros((SIZE,SIZE,3),np.float64)
    for left,right,density in [(0,BARK_X,scale),(BARK_X,SIZE,SIZE/bark_metres)]:
        h=height[:,left:right].astype(np.float64)/65535*(range_mm/1000)
        dx=np.empty_like(h);dy=np.empty_like(h)
        dx[:,1:-1]=(h[:,2:]-h[:,:-2])*.5
        dx[:,0]=h[:,1]-h[:,0];dx[:,-1]=h[:,-1]-h[:,-2]
        dy[1:-1]=(h[2:]-h[:-2])*.5
        if left==BARK_X:
            dy[0]=(h[1]-h[-1])*.5;dy[-1]=(h[0]-h[-2])*.5
        else:
            dy[0]=h[1]-h[0];dy[-1]=h[-1]-h[-2]
        n=np.stack([-dx*density,dy*density,np.ones_like(h)],axis=-1)
        n/=np.sqrt(np.sum(n*n,axis=-1,keepdims=True))
        out[:,left:right]=n
    return out


def labelled(im,text):
    im=im.convert('RGB')
    canvas=Image.new('RGB',(im.width,im.height+34),(24,27,25))
    canvas.paste(im,(0,34))
    ImageDraw.Draw(canvas).text((10,8),text,font=font(17),fill=(234,237,232))
    return canvas


def packed_statistics(orm, alpha):
    """Linear channel statistics over drawn pixels, never transparent padding."""
    drawn = alpha > 0
    values = orm[drawn].astype(np.float64)/255
    return {
        'drawn_pixels': int(drawn.sum()),
        'occlusion_mean': float(values[:,0].mean()),
        'roughness_mean': float(values[:,1].mean()),
        'occlusion_min_max': [float(values[:,0].min()), float(values[:,0].max())],
        'roughness_min_max': [float(values[:,1].min()), float(values[:,1].max())],
        'alpha_weighted_occlusion_mean': float(np.average(values[:,0], weights=alpha[drawn])),
        'alpha_weighted_roughness_mean': float(np.average(values[:,1], weights=alpha[drawn])),
    }


def save_review_images(base,height,normal,orm,layout):
    CHECKS.mkdir(exist_ok=True)
    smallrgb,smalla=resize_channels(base,256)
    for name,bg in BACKGROUNDS.items():
        Image.fromarray(composite(base[...,:3],base[...,3],bg)).save(CHECKS/f'base_{name}_2048.png')
        Image.fromarray(composite(smallrgb,smalla,bg)).save(CHECKS/f'base_{name}_256.png')
    dark=composite(base[...,:3],base[...,3],BACKGROUNDS['dark'])
    panels=[('BASE / sRGB + alpha',dark),('HEIGHT / 0–20 mm',np.repeat((height/257).astype(np.uint8)[...,None],3,axis=-1)),
            ('NORMAL / OpenGL +Y',normal),('ORM / occlusion, roughness, metalness',orm)]
    sheet=Image.new('RGB',(1536,1604),(24,27,25))
    for i,(title,data) in enumerate(panels):
        panel=labelled(Image.fromarray(data).resize((768,768),Image.Resampling.LANCZOS),title)
        sheet.paste(panel,((i%2)*768,(i//2)*802))
    sheet.save(CHECKS/'layers.jpg',quality=94)
    over=Image.fromarray(dark);draw=ImageDraw.Draw(over)
    for e in layout['elements']:
        x0,y0,x1,y1=e['rect']
        draw.rectangle((x0,y0,x1-1,y1-1),outline=(102,213,222),width=2)
        draw.text((x0+7,y0+5),e['name'],fill=(245,245,238),font=font(21))
        if 'anchor' in e:
            ax,ay=e['anchor'];tx,ty=e['tip']
            draw.line((ax,ay,tx,ty),fill=(245,222,121),width=2)
            draw.ellipse((ax-6,ay-6,ax+6,ay+6),fill=(247,124,82))
            draw.ellipse((tx-5,ty-5,tx+5,ty+5),fill=(91,231,222))
    over.save(CHECKS/'layout.png')
    # Review elements at actual atlas resolution, not just thumbnails.
    gallery=[]
    N=normal.astype(np.float32)/127.5-1
    N/=np.linalg.norm(N,axis=-1,keepdims=True)
    lights=[np.array([-.65,.5,.65]),np.array([.65,-.5,.65])]
    lit=[]
    for light in lights:
        light/=np.linalg.norm(light)
        lambert=np.maximum(0,np.sum(N*light,axis=-1))
        # Match the game: AO attenuates ambient sky light only, not direct light.
        illumination=.28*(orm[...,0]/255)+.82*lambert
        # Linear-light albedo; leave roughness visible in separate ORM.
        s=base[...,:3].astype(np.float32)/255
        lin=np.where(s<=.04045,s/12.92,((s+.055)/1.055)**2.4)
        color=lin*illumination[...,None]
        srgb=np.where(color<=.0031308,color*12.92,1.055*np.maximum(color,0)**(1/2.4)-.055)
        col=(srgb*255).clip(0,255)
        lit.append(composite(col,base[...,3],BACKGROUNDS['dark']))
    for e in layout['elements']:
        x0,y0,x1,y1=e['rect'];w=x1-x0;h=y1-y0
        pair=Image.new('RGB',(w*2+16,h+34),(24,27,25))
        for j in range(2):
            p=Image.fromarray(lit[j][y0:y1,x0:x1])
            pair.paste(p,(j*(w+16),34))
        ImageDraw.Draw(pair).text((8,8),e['name']+' / upper-left and lower-right light',font=font(16),fill='white')
        pair.save(CHECKS/f"relit_{e['name']}.png")
        thumb=Image.new('RGB',(600,350),(24,27,25))
        pair.thumbnail((584,334),Image.Resampling.LANCZOS)
        thumb.paste(pair,((600-pair.width)//2,(350-pair.height)//2))
        gallery.append(thumb)
    grid=Image.new('RGB',(1800,1750),(24,27,25))
    for i,panel in enumerate(gallery):grid.paste(panel,((i%3)*600,(i//3)*350))
    grid.save(CHECKS/'relit_contact.jpg',quality=93)
    # Specimen contact sheet at native atlas scale, with useful names and descriptions.
    contact=Image.new('RGB',(1600,2000),(42,44,43))
    for i,e in enumerate(layout['elements'][:-1]):
        x0,y0,x1,y1=e['rect'];im=Image.fromarray(dark[y0:y1,x0:x1])
        im.thumbnail((370,450),Image.Resampling.LANCZOS)
        cx=(i%4)*400;cy=(i//4)*500
        contact.paste(im,(cx+(400-im.width)//2,cy+32))
        ImageDraw.Draw(contact).text((cx+15,cy+8),e['name'],font=font(20),fill=(230,232,221))
    contact.save(CHECKS/'elements.jpg',quality=95)


def main():
    layout=json.loads((ROOT/'layout.json').read_text())
    recipe=json.loads((ROOT/'source/recipe.json').read_text())
    meta=json.loads((ROOT/'source/build_metadata.json').read_text())
    loaded={name:Image.open(ROOT/f'seagrape_{name}.png') for name in ['base','height','normal','orm']}
    arrays={k:np.array(v) for k,v in loaded.items()}
    base,height,normal,orm=[arrays[k] for k in ['base','height','normal','orm']]
    failures=[]
    def require(ok,message):
        if not bool(ok):failures.append(message)
    for name,im in loaded.items():require(im.size==(SIZE,SIZE),name+' dimensions')
    require(loaded['base'].mode=='RGBA','base RGBA')
    require(loaded['normal'].mode=='RGB','normal RGB')
    require(loaded['orm'].mode=='RGB','ORM RGB')
    header=(ROOT/'seagrape_height.png').read_bytes()[24:26]
    require(header==bytes([16,0]),'height 16-bit grayscale PNG IHDR')
    require('srgb' in loaded['base'].info,'base sRGB chunk')
    require(np.all(orm[...,2]==0),'nonzero metalness')
    require(np.all(height[base[...,3]==0]==0),'nonzero height outside alpha')
    require(not (ROOT/'seagrape_regions.png').exists(),'unexpected regions texture')
    expected={f'leaf{i}' for i in range(1,11)}|{f'fruit{i}' for i in range(1,4)}|{'twig1','bark'}
    require({e['name'] for e in layout['elements']}==expected,'element set')
    require(len(layout['elements'])==15,'element count')
    measure={};occupancy=np.zeros((SIZE,SIZE),np.uint8)
    for e in layout['elements']:
        name=e['name'];x0,y0,x1,y1=e['rect']
        require(0<=x0<x1<=SIZE and 0<=y0<y1<=SIZE,name+' rectangle bounds')
        require(not occupancy[y0:y1,x0:x1].any(),name+' overlapping rectangle')
        occupancy[y0:y1,x0:x1]+=1
        a=base[y0:y1,x0:x1,3];mask=a>0
        yy,xx=np.where(mask)
        margins=[int(xx.min()),int(yy.min()),int(a.shape[1]-1-xx.max()),int(a.shape[0]-1-yy.max())]
        m={'rect':e['rect'],'alpha_coverage':float((a/255).mean()),
           'nonzero_fraction':float(mask.mean()),'partial_alpha_fraction':float(((a>0)&(a<255)).mean()),
           'half_alpha_64_191_fraction':float(((a>=64)&(a<=191)).mean()),'transparent_margin_px_LTRB':margins,
           'surface_roughness_min_max':[float(orm[y0:y1,x0:x1,1][a>=128].min()/255),float(orm[y0:y1,x0:x1,1][a>=128].max()/255)]}
        m['packed_statistics']=packed_statistics(orm[y0:y1,x0:x1],a)
        if name=='bark':
            require(e.get('role')=='bark','bark role')
            require(e['rect']==[1920,0,2048,2048],'bark rectangle')
            require(e['metres']==.7,'bark metres')
            require(np.all(a==255),'bark alpha')
        else:
            require(x1<=BARK_X,name+' enters bark column')
            require(min(margins)>=24,name+' margin below 24 px')
            ax,ay=e['anchor'];tx,ty=e['tip']
            require(x0<=ax<x1 and y0<=ay<y1,name+' anchor outside rect')
            require(x0<=tx<x1 and y0<=ty<y1,name+' tip outside rect')
            require(base[ay,ax,3]>=64,name+' anchor not on stem')
            require(base[ty,tx,3]>=64,name+' tip not on silhouette')
            require(abs(ax-(x0+x1-1)/2)<=1,name+' anchor not centered')
            require(ty>ay if name.startswith('fruit') else ty<ay,name+' wrong growth direction')
            physical=math.dist(e['anchor'],e['tip'])/layout['scale_px_per_m']
            require(abs(physical-e['metres'])<1e-6,name+' metres versus pixels')
            require(m['half_alpha_64_191_fraction']<.025,name+' excessive half alpha')
            # Antialias must live at the boundary, never throughout the blade face.
            eroded=nd.binary_erosion(a>=128,iterations=2)
            m['partial_alpha_in_eroded_core']=int(((a<255)&eroded).sum())
            require(m['partial_alpha_in_eroded_core']==0,name+' interior transparency')
            labels,n=nd.label(a>=64,structure=np.ones((3,3)))
            sizes=np.bincount(labels.ravel())[1:]
            m['connected_components_ge_3px']=int((sizes>=3).sum())
            require(m['connected_components_ge_3px']==1,name+' disconnected stalk/parts')
            if name.startswith('leaf'):
                holes=nd.binary_fill_holes(a>=128)&~(a>=128)
                labs,num=nd.label(holes);sizes=np.bincount(labs.ravel())[1:]
                m['holes_ge_3px']=int((sizes>=3).sum())
                require(m['holes_ge_3px']==(4 if name=='leaf9' else 0),name+' unexpected hole count')
                width=(xx.max()-xx.min()+1)/layout['scale_px_per_m']
                m['silhouette_width_m']=float(width)
                require(.12<=width<=.252,name+' leaf width')
            if name.startswith('fruit'):
                dims=[b['diameter_m'] for b in meta['elements'][name]['berries']]
                m['berry_count']=len(dims);m['berry_diameters_m']=dims
                require(min(dims)>=.0145 and max(dims)<=.0205,name+' fruit diameter')
                require(.12<=e['metres']<=.252,name+' bunch length')
            if name=='twig1':
                m['annotated_leaf_count']=meta['elements'][name]['leaf_count']
                require(5<=m['annotated_leaf_count']<=8,'twig leaf count')
                require(.30<=e['metres']<=.45,'twig length')
        measure[name]=m
    require(np.all(base[...,3][occupancy==0]==0),'alpha outside declared rectangles')
    expected_n=normals_independent(height,layout['scale_px_per_m'],recipe['height_range_mm'],.7)
    quantized=np.rint((expected_n*.5+.5)*255).clip(0,255).astype(np.uint8)
    delta=np.abs(quantized.astype(np.int16)-normal.astype(np.int16))
    require(int(delta.max())<=1,'normal does not follow delivered height')
    actual_n=normal.astype(float)/127.5-1
    lengths=np.linalg.norm(actual_n,axis=-1)
    actual_n/=lengths[...,None]
    angle=np.degrees(np.arccos(np.clip(np.sum(actual_n*expected_n,axis=-1),-1,1)))
    solid=base[...,3]>=128
    normal_measure={'maximum_channel_error_codes':int(delta.max()),'mean_angle_degrees':float(angle[solid].mean()),
                    'p99_angle_degrees':float(np.percentile(angle[solid],99)), 'max_angle_degrees':float(angle[solid].max()),
                    'max_unit_length_error':float(np.abs(lengths[solid]-1).max())}
    seam={}
    for name,arr in arrays.items():
        diff=np.abs(arr[0,BARK_X:].astype(float)-arr[-1,BARK_X:].astype(float))
        seam[name]={'max_top_bottom_difference':float(diff.max()),'mean_top_bottom_difference':float(diff.mean())}
        require(diff.max()==0,name+' bark seam')
    # Verify at least 32 px of edge colour around every cut-out.
    rgb=base[:,:BARK_X,:3];core=base[:,:BARK_X,3]>=128
    d,ix=nd.distance_transform_edt(~core,return_indices=True)
    ring=(d<=32)&(base[:,:BARK_X,3]==0)
    edge=rgb[ix[0],ix[1]]
    diff=np.abs(rgb.astype(int)-edge.astype(int))
    bleed={'checked_pixels':int(ring.sum()),'max_rgb_difference':int(diff[ring].max()),'mean_rgb_difference':float(diff[ring].mean())}
    require(bleed['max_rgb_difference']==0,'32 px edge bleed mismatch')
    smallrgb,smalla=resize_channels(base,256)
    a=base[...,3].astype(np.float32)/255
    premul=base[...,:3].astype(np.float32)*a[...,None]
    # Use float BOX filtering for reference alpha-weighted colour.
    ref=np.stack([np.array(Image.fromarray(premul[...,c]).resize((256,256),Image.Resampling.BOX)) for c in range(3)],axis=-1)
    af=np.array(Image.fromarray(a).resize((256,256),Image.Resampling.BOX))
    ref=np.divide(ref,af[...,None],out=np.zeros_like(ref),where=af[...,None]>0)
    edge_pixels=(smalla>0)&(smalla<255)
    visible_error=np.abs(smallrgb-ref)*(smalla[...,None]/255)
    mip={'visible_edge_error_mean_codes':float(visible_error[edge_pixels].mean()),
         'visible_edge_error_p95_codes':float(np.percentile(visible_error[edge_pixels],95)),
         'partial_edge_pixels':int(edge_pixels.sum())}
    require(mip['visible_edge_error_p95_codes']<12,'visible mip fringe error')
    results={'passed':len(failures)==0,'failures':failures,'dimensions':[SIZE,SIZE],
             'height_range_mm':recipe['height_range_mm'],'height_used_mm':[float(height.min()/65535*20),float(height.max()/65535*20)],
             'scale_px_per_m':layout['scale_px_per_m'],'bark_px_per_m':SIZE/.7,
             'total_alpha_coverage':float((base[...,3]/255).mean()),
             'total_partial_alpha_fraction':float(((base[...,3]>0)&(base[...,3]<255)).mean()),
             'total_half_alpha_64_191_fraction':float(((base[...,3]>=64)&(base[...,3]<=191)).mean()),
             'packed_statistics':packed_statistics(orm,base[...,3]),
             'cutout_packed_statistics':packed_statistics(orm[:,:BARK_X],base[:,:BARK_X,3]),
             'normal_height_agreement':normal_measure,'bark_vertical_seam':seam,'rgb_bleed_32px':bleed,
             'mip_256':mip,'elements':measure,
             'sha256':{f'seagrape_{name}.png':hashlib.sha256((ROOT/f'seagrape_{name}.png').read_bytes()).hexdigest() for name in loaded}}
    CHECKS.mkdir(exist_ok=True)
    (CHECKS/'measurements.json').write_text(json.dumps(results,indent=2)+'\n')
    save_review_images(base,height,normal,orm,layout)
    print(json.dumps({k:results[k] for k in ['passed','failures','total_alpha_coverage','total_partial_alpha_fraction','normal_height_agreement','mip_256']},indent=2))
    raise SystemExit(0 if results['passed'] else 1)


if __name__=='__main__':main()
