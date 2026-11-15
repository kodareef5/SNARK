"""Round 3 visual evidence, always made from the actual delivered maps.

Called by check.py; can also run directly. Writes only checks/.
The concept pixels are unedited crops, never a source for material pixels.
"""
from pathlib import Path
import json, math
import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import map_coordinates, gaussian_filter
from check import ROOT, QA, FONT, LIGHTS, lin, enc, rgb8, color, relight, caption, grid

REF=ROOT.parents[2]/'ref/concept'


def sampled_material(arrays,size,density,angle=0,center=(1024,1024)):
    """Resample all fields together at an explicit physical display density."""
    b,n,p=arrays; w,h=size; yy,xx=np.mgrid[:h,:w].astype(np.float32)
    ratio=(2048/.284)/density
    dx=(xx-w/2)*ratio;dy=(yy-h/2)*ratio
    co=math.cos(math.radians(angle));si=math.sin(math.radians(angle))
    uv=np.stack([(-si*dx+co*dy+center[1])%2048,(co*dx+si*dy+center[0])%2048])
    sampled=[]
    for field in [b[:,:,:3].astype(np.float32),n,p.astype(np.float32)]:
        field=gaussian_filter(field,(max(.0,(ratio-1)*.45),max(.0,(ratio-1)*.45),0),mode='wrap')
        sampled.append(np.stack([map_coordinates(field[:,:,i],uv,order=1,mode='wrap') for i in range(3)],axis=-1))
    bb,nn,pp=sampled
    nx=nn[:,:,0].copy();ny=nn[:,:,1].copy()
    nn[:,:,0]=co*nx+si*ny;nn[:,:,1]=-si*nx+co*ny
    nn/=np.linalg.norm(nn,axis=-1,keepdims=True)
    return np.uint8(np.clip(np.rint(bb),0,255)),nn,np.uint8(np.clip(np.rint(pp),0,255))


def source_comparison(study):
    manifest=json.loads((ROOT/'source/feathers.json').read_text()); rows=[]; stats={}
    for index in [0,5,12,17,20]:
        item=manifest[index]; raw=Image.open(ROOT/'source'/item['original']).convert('RGBA').crop(item['source_box_px'])
        b=np.array(Image.open(ROOT/item['cutout']));a=b[:,:,3]/255
        h=np.array(Image.open(ROOT/item['height'])).astype(float)/65535
        # Source height's physical span is its documented default example length.
        mm=12 if item['kind']=='cap' else 55; physical_px=mm/max(1,item['tip_px'][1]-item['root_px'][1])
        dy,dx=np.gradient(h);k=study['sets']['cap' if item['kind']=='cap' else 'mane']['height_mm']/physical_px
        n=np.stack([-dx*k,dy*k,np.ones_like(h)],axis=-1);n/=np.linalg.norm(n,axis=-1,keepdims=True)
        pk=np.ones_like(b[:,:,:3])*255;pk[:,:,1]=232;pk[:,:,2]=0
        lit=relight(b,n,pk,'#D4D2CC',LIGHTS[0])
        images=[raw,Image.fromarray(b),lit]
        panels=[]
        for j,im in enumerate(images):
            bg=Image.new('RGB',im.size,(69,62,57))
            bg.paste(im.convert('RGB'),(0,0),raw.getchannel('A') if j==0 else Image.fromarray(np.uint8(a*255)))
            bg.thumbnail((330,460),Image.Resampling.LANCZOS)
            panel=Image.new('RGB',(350,480),(69,62,57));panel.paste(bg,((350-bg.width)//2,10))
            panels.append(caption(panel,['Generated original RGB','Prepared neutral base','Prepared relief, relit'][j]))
        row=Image.new('RGB',(1050,548),(26,29,32));d=ImageDraw.Draw(row)
        d.text((12,8),item['id']+' — identical crop / identical display scale',font=FONT,fill='white')
        for j,im in enumerate(panels):row.paste(im,(j*350,34))
        rows.append(row)
        valid=(a>=.5)&(np.array(raw)[:,:,3]>=128)
        x=lin(np.array(raw)[:,:,:3]/255).mean(2);y=lin(b[:,:,:3]/255).mean(2)
        stats[item['id']]=float(np.corrcoef(x[valid],y[valid])[0,1])
    out=Image.new('RGB',(1050,len(rows)*548))
    for i,row in enumerate(rows):out.paste(row,(0,i*548))
    out.save(QA/'original_base_relit.jpg',quality=97)
    return stats


def cap_comparison(arrays):
    """Requested round-3 finish: untouched crown, umber and near-white at scale."""
    head=Image.open(REF/'head_side.png').convert('RGB')
    ref=head.crop((740,130,1400,410)); width=660
    out=Image.new('RGB',(1980,600),(26,29,32));d=ImageDraw.Draw(out)
    d.text((16,12),'ROUND 3 / rounded cap / actual delivered maps / same physical scale as the concept',font=FONT,fill='white')
    b,n,p=sampled_material(arrays['cap'],ref.size,4500,-55)
    for col,(title,im) in enumerate([
        ('Concept crown / unchanged pixels / 4500 px/m',ref),
        ('Cap / umber #413225 / relit / 4500 px/m',relight(b,n,p,'#413225',LIGHTS[0])),
        ('Cap / near-white #F3F1EA / relit / 4500 px/m',relight(b,n,p,'#F3F1EA',LIGHTS[0]))]):
        out.paste(caption(im,title),(col*width,48))
    d.text((16,392),'Native whole-bird concept density: 1500 px/m. No enlargement in this row.',font=FONT,fill='white')
    small=ref.resize((220,93),Image.Resampling.LANCZOS)
    b,n,p=sampled_material(arrays['cap'],small.size,1500,-55)
    for col,im in enumerate([small,relight(b,n,p,'#413225',LIGHTS[0]),relight(b,n,p,'#F3F1EA',LIGHTS[0])]):
        out.paste(im,(col*width+10,432))
    d.text((16,559),'8-12 / 15-20 mm feathers; placement density and relief settings unchanged. Flow rotated 55 degrees to follow the crown.',font=FONT,fill='white')
    out.save(QA/'cap_concept_round3.jpg',quality=98)


def round3_review(study,arrays):
    cap_comparison(arrays)
    head=Image.open(REF/'head_side.png').convert('RGB')
    # build_round4.mjs: the side head master is exactly 3x the 1500 px/m view.
    density=4500; width=660
    out=Image.new('RGB',(width*3,1120),(26,29,32))
    d=ImageDraw.Draw(out)
    d.text((16,12),'ROUND 3 / concept at native 4500 px/m / material sampled at the same physical scale',font=FONT,fill='white')
    boxes={'cap':(740,130,1400,410),'mane':(1050,460,1430,900)}
    for name,y,angle in [('cap',48,-55),('mane',396,0)]:
        box=boxes[name];ref=head.crop(box);w,h=ref.size
        b,n,p=sampled_material(arrays[name],(w,h),density,angle)
        unlit=Image.fromarray(rgb8(enc(lin(b/255)*color('#413225')/.5)))
        lit=relight(b,n,p,'#413225',LIGHTS[0])
        for col,(title,im) in enumerate([(name+' / concept, unedited',ref),(name+' / umber base, unlit',unlit),(name+' / umber, relit',lit)]):
            out.paste(caption(im,title),(col*width,y))
    d.text((16,912),'Native orthographic scale, 1500 px/m: concept and material; no enlargement below',font=FONT,fill='white')
    for col,name in enumerate(['cap','mane']):
        ref=head.crop(boxes[name]);small=ref.resize((round(ref.width/3),round(ref.height/3)),Image.Resampling.LANCZOS)
        b,n,p=sampled_material(arrays[name],small.size,1500,-55 if name=='cap' else 0)
        out.paste(small,(20+col*640,952));out.paste(relight(b,n,p,'#413225',LIGHTS[0]),(270+col*640,952))
    out.save(QA/'concept_scale_comparison.jpg',quality=98)

    # 2048 -> 512 reduction happens BEFORE alpha test. This is the game cutout.
    b,n,p=arrays['hood_cards'];shade=relight(b,n,p,'#413225',LIGHTS[0])
    shade=shade.resize((512,512),Image.Resampling.LANCZOS)
    a=np.array(Image.fromarray(b).resize((512,512),Image.Resampling.LANCZOS))[:,:,3]>=128
    rose=Image.new('RGB',(512,512),(221,160,137));rose.paste(shade,(0,0),Image.fromarray(np.uint8(a*255)))
    rose.save(QA/'cards_quarter_on_rose.png')
    # The comparison uses the same 1500 px/m face reference crop at native size.
    edge=head.crop((1000,400,1220,670)).resize((73,90),Image.Resampling.LANCZOS)
    plate=Image.new('RGB',(1240,820),(26,29,32));plate.paste(caption(rose,'Entire sheet at 512 px, alpha cut at 0.5'),(16,16))
    edge_panel=Image.new('RGB',(420,110),(26,29,32));edge_panel.paste(edge,(0,0))
    plate.paste(caption(edge_panel,'Concept edge / native 1500 px/m'),(560,16))
    edge_big=edge.resize((292,360),Image.Resampling.NEAREST)
    plate.paste(caption(edge_big,'Concept pixels, 4x nearest'),(560,174))
    # A selection of reduced tuft/feather cutouts, enlarged without new detail.
    panels=[]
    for idx in [1,3,6,7,10,13,16,17]:
        el=study['sets']['hood_cards']['elements'][idx]
        box=[math.floor(v/4)-2 if k<2 else math.ceil(v/4)+2 for k,v in enumerate(el['box_px'])]
        crop=rose.crop(box).resize(((box[2]-box[0])*4,(box[3]-box[1])*4),Image.Resampling.NEAREST)
        panel=Image.new('RGB',(260,210),(221,160,137));crop.thumbnail((250,200),Image.Resampling.NEAREST)
        panel.paste(crop,((260-crop.width)//2,(210-crop.height)//2));panels.append((el['id'],panel))
    # A separate full contact avoids scaling the 512 atlas to fit a review page.
    grid(panels,4,260).save(QA/'cards_quarter_fringe_detail.png')
    d=ImageDraw.Draw(plate)
    d.text((16,580),'Rose #DDA089. Quarter-sheet is shown at native size above.',font=FONT,fill='white')
    d.text((16,612),'Fine open barb gaps and split tips survive the 0.5 cut; source RGB is dilated beyond the fringe.',font=FONT,fill='white')
    plate.save(QA/'cards_concept_comparison.jpg',quality=98)

    # Full tile drawing beside its own relit result, at identical scale.
    panels=[]
    for name in ['cap','mane','cap_to_mane']:
        b,n,p=arrays[name]
        base=Image.fromarray(rgb8(enc(lin(b[:,:,:3]/255)*color('#413225')/.5)))
        lit=relight(b,n,p,'#413225',LIGHTS[0])
        panels.extend([(name+' / unlit base',base),(name+' / relit',lit)])
    grid(panels,2,640).save(QA/'drawing_unlit_and_relit.jpg',quality=97)
    return dict(concept_density_px_per_m=density,orthographic_density_px_per_m=1500,
                concept_head_scale_source='ref/concept/build_round4.mjs: specs.side.scale = 3',
                concept_boxes_px=boxes,cap_preview_rotation_degrees=-55,
                source_base_correlations=source_comparison(study),
                card_size_px=512,card_cutoff=.5,
                comparisons=['cap_concept_round3.jpg','concept_scale_comparison.jpg','cards_quarter_on_rose.png',
                             'cards_concept_comparison.jpg','cards_quarter_fringe_detail.png',
                             'original_base_relit.jpg','drawing_unlit_and_relit.jpg'])


if __name__=='__main__':
    study=json.loads((ROOT/'study.json').read_text());arrays={}
    for name in study['sets']:
        b=np.array(Image.open(ROOT/f'{name}_base.png'))
        n=np.array(Image.open(ROOT/f'{name}_normal.png')).astype(np.float32)/127.5-1
        n/=np.linalg.norm(n,axis=-1,keepdims=True)
        p=np.array(Image.open(ROOT/f'{name}_packed.png'));arrays[name]=(b,n,p)
    print(json.dumps(round3_review(study,arrays),indent=2))
