"""Audit owned maps and make review sheets from actual game-rendered images."""
from pathlib import Path
import hashlib,json,site,sys,tempfile
site.addsitedir(site.getusersitepackages());sys.dont_write_bytecode=True
import numpy as np
from PIL import Image,ImageDraw
from scipy.ndimage import distance_transform_edt
import paint
ROOT=Path(__file__).resolve().parent;QA=ROOT/'checks';OUT=ROOT/'layers'
def board(items,cols=2,width=627):
 h=max(round(im.height*width/im.width) for _,im in items);b=Image.new('RGB',(cols*width,((len(items)+cols-1)//cols)*(h+28)),(28,30,33));d=ImageDraw.Draw(b)
 for i,(label,im) in enumerate(items):
  x=i%cols*width;y=i//cols*(h+28);im=im.resize((width,round(im.height*width/im.width)),Image.Resampling.LANCZOS);b.paste(im,(x,y+28));d.text((x+8,y+8),label,fill='white')
 return b

def check():
 QA.mkdir(exist_ok=True);meta=json.loads((paint.PAINT/'pieces.json').read_text());piece=np.asarray(Image.open(paint.PAINT/'pieces.png'))[...,0]
 numbers=[p['number'] for p in meta['pieces'] if p['name'] in ['shell_body','wing_l_out','wing_l_in','shoulder_l']];own=np.isin(piece,numbers)
 info=json.loads((OUT/'layers.json').read_text());fail=[];facts={}
 def require(ok,text):
  if not ok:fail.append(text)
 for path,digest in info['inputs'].items():require(hashlib.sha256((paint.DODO/path).read_bytes()).hexdigest()==digest,'Stale input '+path)
 maps={}
 for prefix in ['dodo','cards']:
  data={}
  for role in ['base','height','rough','occlusion','regions']:
   im=Image.open(OUT/f'{prefix}_{role}.png');require(im.size==(2048,2048),prefix+' '+role+' dimensions');data[role]=np.asarray(im)
   require((im.mode.startswith('I') or im.mode=='I;16') if role=='height' else True,prefix+' 16-bit height')
  maps[prefix]=data;b=data['base'];r=data['regions'];valid=b[...,3]>=128
  if prefix=='dodo':
   require(np.array_equal(valid,own),'Opaque alpha exactly owns all four pieces')
   require(np.all(r[~own]==0),'No region paint outside ownership')
  else:
   x0,y0,x1,y1=info['cards']['box'];area=np.zeros(own.shape,bool);area[y0:y1,x0:x1]=True
   require(not np.any(valid&~area),'Cards restricted to body rectangle')
   require(np.all(r[area]==[255,0,0]),'Body cards are plain')
   for x in [x0,(x0*3+x1)//4,(x0+x1)//2,(x0+x1*3)//4,x1-1]:require(not np.any(valid[y0:y1,max(x-1,0):min(x+2,2048)]),'Complete feathers at card quarter '+str(x))
   local=b[y0:y1,x0:x1];m=local[...,3]>=128;dist=distance_transform_edt(~m)
   quiet=dist>16;hh=data['height'][y0:y1,x0:x1];require(np.ptp(hh[quiet])==0,'Quiet card gutters')
   facts['card_gutter_range_u16']=int(np.ptp(hh[quiet]));facts['cards']=info['cards']
   require(info['cards']['physical_strip_mm']==meta['cards']['body']['card_mm'],'Card span follows live model')
   require(info['cards']['mm_per_texel']==meta['cards']['body']['mm_per_texel'],'Card texel size follows live model')
  require(np.max(np.ptp(b[valid,:3].astype(int),axis=-1))==0,prefix+' neutral base')
  palette=np.unique(r.reshape(-1,3),axis=0);require(all(tuple(c) in [(0,0,0),(255,0,0),(255,255,0)] for c in palette),prefix+' pure permitted regions')
  means={}
  for label,col in [('body',(255,0,0)),('cream',(255,255,0))]:
   m=valid&np.all(r==col,-1)
   if m.any():means[label]=float(paint.lin(b[...,0][m]/255).mean());require(abs(means[label]-.5)<.02,prefix+' '+label+' mean')
  facts[prefix]={'means_linear':means,'height_mm':[float(data['height'][valid].min()/65535*4),float(data['height'][valid].max()/65535*4)]}
 ids=np.load(QA/'ownership.npz');bar=maps['dodo']['regions'][...,1]>128
 distinct=np.unique(ids['rows'][bar]);require(len(distinct)==5,'Exactly five source rows own yellow tips')
 require(np.all(np.diff(distinct)==1),'Barred rows are consecutive')
 facts['bar_rows']=distinct.tolist();facts['bar_texels']=int(bar.sum());facts['piece_stats']=info['stats']
 source=paint.fields()['barred']
 depths=[paint.brush_depth(el,el['terminal_scale'],field='tip_bar') for el in source]
 side_depths=[paint.brush_depth(el,el['terminal_scale'],.85,field='tip_bar') for el in source]
 profiles=[paint.brush_profile(el,field='tip_bar') for el in source]
 cores=[q['core_mm'] for q in profiles];reaches=[q['reach_mm'] for q in profiles]
 dissolves=np.array(reaches)-np.array(cores)
 require(min(reaches)>9 and max(reaches)<11,'Nominal source reach covers the deeper terminal brush')
 facts['bar_solid_and_soft_depth_mm']={'solid_core_range':[min(cores),max(cores)],'soft_reach_range':[min(reaches),max(reaches)],'profiles':profiles,'definition':'Nominal 59 mm vane, alpha >= 0.5. Solid core counts coverage > 0.95, excluding both the outer fringe and inward dissolve; its difference from reach is NOT the inner dissolve width. Actual delivered depth and inner transition are measured below.'}
 facts['bar_brush_coverage_depth_mm']={'shaft_range':[min(depths),max(depths)],'shaft_median':float(np.median(depths)),'side_median':float(np.median(side_depths)),'definition':'Integrated generated strand coverage through a 59 mm vane, before placement jitter and overlap.'}
 facts['source_non_solid_span_mm']=[float(min(dissolves)),float(max(dissolves))]
 # The delivery is judged after physical projection, occlusion, resampling
 # and binary region assignment. Source reach alone was misleading.
 from atlas_review import measurements
 measured=measurements();facts['composed_tip_depth']=measured
 lo,hi=measured['shaft_reach_range_mm']
 require(lo>=8 and hi<=10.5,'Actual composed tips reach 8--10 mm at their shafts (half-texel tolerance)')
 require(2<=measured['side_reach_median_mm']<=3.2,'Actual composed tips taper to 2--3 mm at their sides')
 require(4<=measured['dissolve_90_to_10_mm']<=6,'Composed strand coverage dissolves over 4--6 mm')
 placement=json.loads((QA/'placements.json').read_text())
 cream_values=paint.lin(maps['dodo']['base'][...,0][bar]/255)
 facts['cream_value_percentiles_linear']={str(q):float(np.percentile(cream_values,q)) for q in [0,5,50,95,100]}
 require(float(cream_values.max())<.56,'Pale barb values remain within muted cream')
 before=QA/'round3_before'
 if (before/'placements.json').exists():
  old=json.loads((before/'placements.json').read_text())
  same=[s for s in old if s['family']!='barred']==[s for s in placement if s['family']!='barred']
  require(same,'Accepted plain placements unchanged');facts['plain_placements_unchanged']=same
  cards_same={f.name:hashlib.sha256(f.read_bytes()).hexdigest()==hashlib.sha256((before/'layers'/f.name).read_bytes()).hexdigest() for f in OUT.glob('cards_*.png')}
  require(all(cards_same.values()),'Accepted body cards unchanged');facts['body_cards_unchanged']=cards_same
 facts['bar_tip_nominal_width_mm']=[min(s['tip_width_mm'] for s in placement if s['family']=='barred'),max(s['tip_width_mm'] for s in placement if s['family']=='barred')]
 accepted=QA/'round4_before'
 if (accepted/'placements.json').exists():
  unchanged=json.loads((accepted/'placements.json').read_text())==placement
  require(unchanged,'All accepted placements, including barred rows, unchanged')
  previous=np.asarray(Image.open(accepted/'layers/dodo_regions.png'))[...,1]>128
  require(np.array_equal(previous,ids['previous_bar']),'Accepted tip construction retained for normalization')
  old_base=np.asarray(Image.open(accepted/'layers/dodo_base.png'))
  same_base=np.array_equal(old_base[~(previous|bar)],maps['dodo']['base'][~(previous|bar)])
  require(same_base,'Base outside old/new pale tips is byte-identical')
  old_h=np.asarray(Image.open(accepted/'layers/dodo_height.png')).astype(float)
  change=np.abs(maps['dodo']['height'].astype(float)-old_h)/65535*4
  require(change.max()<.025,'Tip detail adds only fine vane relief')
  require(not np.any(change[np.abs(ids['tip_relief'])<1e-8]),'Height unchanged outside restored barb relief')
  rough_same=hashlib.sha256((accepted/'layers/dodo_rough.png').read_bytes()).digest()==hashlib.sha256((OUT/'dodo_rough.png').read_bytes()).digest()
  require(rough_same,'Accepted roughness unchanged')
  facts['round4_preserved']={'all_placements':unchanged,'base_outside_pale_tips':same_base,'roughness':rough_same,'maximum_relief_change_mm':float(change.max())}
 accepted5=QA/'round5_before'
 if (accepted5/'placements.json').exists():
  untouched={name:hashlib.sha256((OUT/name).read_bytes()).hexdigest()==hashlib.sha256((accepted5/'layers'/name).read_bytes()).hexdigest()
      for name in ['dodo_height.png','dodo_rough.png','dodo_occlusion.png',*[p.name for p in OUT.glob('cards_*.png')]]}
  require(all(untouched.values()),'Previous relief, occlusion, roughness and all cards remain byte-identical')
  old_mask=np.asarray(Image.open(accepted5/'layers/dodo_regions.png'))[...,1]>128
  old_base=np.asarray(Image.open(accepted5/'layers/dodo_base.png'))
  same=np.array_equal(old_base[~(old_mask|bar)],maps['dodo']['base'][~(old_mask|bar)])
  require(same,'Plain base outside previous/new tips remains byte-identical')
  require(json.loads((accepted5/'placements.json').read_text())==placement,'Previous placement records remain identical')
  facts['round5_preserved']={'maps_byte_identical':untouched,'base_outside_tips':same,'all_placements':True}
 centres=np.array([s['centre'] for s in placement if s['piece']=='shell_body' and s['family']=='barred' and s['col']==0])
 pitch=np.linalg.norm(np.diff(centres,axis=0),axis=1)
 facts['bar_midline_pitch_mm']=pitch.tolist();require(len(pitch)==4 and np.ptp(pitch)<12,'Five regularly spaced physical rows')
 for p in meta['pieces']:
  if p['number'] in numbers and p['name']!='shell_body':require(not np.any(bar&(piece==p['number'])),'Wing and shoulder remain plain')
 # Check the composed ring rule only where this group participates.
 cp=QA/'composed';rg=np.asarray(Image.open(cp/'dodo_regions.png'));ring=[(255,0,0),(255,255,0),(0,255,0),(0,255,255),(0,0,255),(255,0,255)];idx=np.full(own.shape,-1)
 for i,col in enumerate(ring):idx[np.all(rg==col,-1)]=i
 total=ours=0
 for ax in [0,1]:
  other=np.roll(idx,1,ax);delta=abs(idx-other);bad=(idx>=0)&(other>=0)&(delta!=0)&(delta!=1)&(delta!=5)
  total+=int(bad.sum());ours+=int((bad&(own|np.roll(own,1,ax))).sum())
 require(ours==0,'No ring-rule break touches body group');facts['composed_ring_breaks']={'all_groups':total,'involving_body':ours}
 # Numerical lighting audit on the same physical normal construction used by compose.
 sys.path.insert(0,str(paint.PAINT));import compose
 h=maps['dodo']['height']/65535*info['height_mm'];mm=np.asarray(Image.open(paint.PAINT/'texel_mm.png'))/1000
 n=compose.normal_from_height(h,mm,piece);value=paint.lin(maps['dodo']['base'][...,0]/255)
 correlations=[]
 for L in [[.7,.6,1],[-.7,-.3,1],[0,-1,1]]:
  q=np.maximum(np.sum(n*(np.array(L)/np.linalg.norm(L)),-1),0);correlations.append(float(np.corrcoef(value[own],q[own])[0,1]))
 require(max(abs(q) for q in correlations)<.12,'No significant tangent light in base')
 facts['base_light_correlations']=correlations
 quad=[float(value[y:y+1024,x:x+1024][own[y:y+1024,x:x+1024]].mean()) for y in [0,1024] for x in [0,1024]]
 facts['quadrant_means_owned']=quad;require((max(quad)-min(quad))/np.mean(quad)<.02,'Owned quadrant means within two percent')
 frozen=QA/'round1_before/study_hashes.json'
 if frozen.exists():
  unchanged={path:hashlib.sha256((paint.DODO/path).read_bytes()).hexdigest()==digest for path,digest in json.loads(frozen.read_text()).items()}
  require(all(unchanged.values()),'All accepted study maps remain byte-identical')
  facts['accepted_study_maps_unchanged']=unchanged
 require(not list(ROOT.rglob('*.snpk')),'No built packs under body assets')
 require(not list(ROOT.rglob('*.ts')),'Body review scripts are Python only')
 facts['material_occlusion_min']=float(maps['dodo']['occlusion'][own].min()/255)
 facts['sha256']={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in OUT.glob('*.png')}
 facts['material_passed']=not fail
 facts['requested_spacing_satisfied']=bool(len(pitch)==4 and np.all((pitch>=40)&(pitch<=45)))
 if not facts['requested_spacing_satisfied']:fail.append('Requested 40--45 mm physical spacing not met')
 facts['failed']=fail;facts['passed']=not fail
 (QA/'validation.json').write_text(json.dumps(facts,indent=2)+'\n');print(json.dumps(facts,indent=2));return facts

def sheets(label):
 game=QA/label
 # Official look.sh cameras are oblique, not the concept's orthographic views.
 # Show that difference explicitly; these are unretouched game renderings.
 concept=paint.DODO/'ref/concept'
 board([('Concept top',Image.open(concept/'top.png')),('Game / elevated back, 55 degrees',Image.open(game/'back_bars_default.png')),('Concept back',Image.open(concept/'back.png')),('Game / back three-quarter',Image.open(game/'bird_back_right_default.png'))],2,627).save(QA/'back_top_beside_concept.jpg',quality=96)
 views=QA/'concept_views'
 if (views/'inputs.json').exists():
  items=[]
  for view in ['back','top']:
   items.extend([(f'Concept {view} / 0.836 m frame',Image.open(concept/f'{view}.png')),(f'Game {view} / matching nominal frame',Image.open(views/f'{view}_default.png'))])
  board(items,2,627).save(QA/'back_top_beside_concept.jpg',quality=96)
 board([('Concept side',Image.open(concept/'side.png')),('Game / side',Image.open(game/'bird_side_default.png')),('Game / neck close-up',Image.open(game/'head_side_default.png')),('Game / breast three-quarter',Image.open(game/'bird_front_left_default.png'))],2,700).save(QA/'neck_breast_beside_concept.jpg',quality=96)
 # Comparable crops: concept 1500 px/m, renderer close-up 2250 px/m.
 # Upsampling the concept by 1.5 gives the same physical image scale.
 top=Image.open(concept/'top.png').crop((450,608,804,888)).resize((531,420),Image.Resampling.LANCZOS)
 back=Image.open(concept/'back.png').crop((447,579,807,759)).resize((540,270),Image.Resampling.LANCZOS)
 rendered=Image.open(game/'back_bars_default.png').crop((330,185,870,605))
 board([('Concept top / 2250 px per metre',top),('Game back / 2250 px per metre, oblique',rendered),('Concept rump / 2250 px per metre',back),('Game lower bars / same image scale',Image.open(game/'back_bars_default.png').crop((330,335,870,605)))],2,600).save(QA/'bars_beside_concept.jpg',quality=96)
 card=Image.open(OUT/'cards_base.png');spec=json.loads((OUT/'layers.json').read_text())['cards'];box=spec['box'];w,h=spec['physical_strip_mm']
 strip=card.crop(tuple(box)).resize((800,round(800*h/w)),Image.Resampling.LANCZOS);bg=Image.new('RGBA',strip.size,(86,91,97,255));bg.alpha_composite(strip)
 board([(f'Body strip / {w} x {h} mm / four complete quarters',bg.convert('RGB')),('Body cards / actual 512 atlas',card.resize((512,512),Image.Resampling.LANCZOS).convert('RGB'))],2,600).save(QA/'body_cards.jpg',quality=95)
 # Preserve the actual mip-rendered sizes: no substitute Python downsampling.
 board([(dye+' / actual 200, 100, 50, 20 px draws + 4x enlargements',Image.open(game/f'sizes_side_{dye}.png')) for dye in ['default','loud','dark']],1,1600).save(QA/'game_read_sizes.jpg',quality=96)
def rebuild():
 expected={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in OUT.iterdir() if p.is_file()}
 old_out,old_qa=paint.OUT,paint.QA
 try:
  with tempfile.TemporaryDirectory(prefix='body-rebuild-',dir='/private/tmp/dodo-look') as temp:
   paint.OUT=Path(temp)/'layers';paint.QA=Path(temp)/'checks';paint.build()
   actual={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in paint.OUT.iterdir() if p.is_file()}
 finally:paint.OUT,paint.QA=old_out,old_qa
 result={'identical':expected==actual,'expected':expected,'rebuilt':actual}
 (QA/'rebuild.json').write_text(json.dumps(result,indent=2)+'\n')
 if not result['identical']:raise RuntimeError('Clean rebuild differs')
if __name__=='__main__':
 if '--rebuild' in sys.argv:rebuild()
 facts=check()
 if '--look' in sys.argv:sheets(sys.argv[sys.argv.index('--look')+1])
 if not facts['passed']:raise SystemExit(1)
