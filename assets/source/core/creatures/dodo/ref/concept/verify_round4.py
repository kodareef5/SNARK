"""Independent numerical audits only. Does not create or edit any image."""
from pathlib import Path
from datetime import datetime, timezone
import json, hashlib
import numpy as np
from PIL import Image
from scipy import ndimage as nd
R=Path(__file__).resolve().parent;S=R/'sources/round4';C=R/'checks'
BG=np.array([214,212,206]);PAL=[[0,0,0],[255,0,0],[255,255,0],[0,255,0],[0,255,255],[0,0,255],[255,0,255],[255,255,255],[128,128,128]]
V=['side','front','back','top'];FILES=[f'{v}{suffix}.png' for v in V for suffix in ['', '_mask']]+[f'regions_{v}.png' for v in V]+['three_quarter.png','head_side.png','head_front.png','variants.png','read_sizes.png']
def rgb(p):return np.array(Image.open(R/p).convert('RGB'))
def sha(p):return hashlib.sha256((R/p).read_bytes()).hexdigest()
def bbox(m):
 y,x=np.where(m);return [int(x.min()),int(y.min()),int(x.max()+1),int(y.max()+1)]
def sym(a,c=627):
 n=min(c,a.shape[1]-c-1);return np.array_equal(a[:,c+1:c+n+1],a[:,c-n:c][:,::-1])
def envelope(m):
 if not m.any():return None
 b=bbox(m);return {'bbox_xyxy_exclusive':b,'width_px':b[2]-b[0],'height_px':b[3]-b[1]}
def locmax(d,m):
 a=np.where(m,d,-1);y,x=np.unravel_index(a.argmax(),a.shape);return {'distance_px':float(a[y,x]),'xy':[int(x),int(y)]}
def poly_mask(x,y,points):
 hit=np.zeros(x.shape,bool)
 for (x1,y1),(x2,y2) in zip(points,points[1:]+points[:1]):
  if y1!=y2:hit^=((y1>y)!=(y2>y))&(x<(x2-x1)*(y-y1)/(y2-y1)+x1)
 return hit
def main():
 checks={};results={};preservation={};assets={};diagnostics={};pixel={}
 def check(k,v):checks[k]=bool(v)
 for f in FILES:
  im=Image.open(R/f);im.load();assets[f]={'size':list(im.size),'mode':im.mode,'sha256':sha(f)}
 check('all_17_assets_readable',len(assets)==17)
 previous=json.loads((C/'round3_archive/measurements.json').read_text());ann=json.loads((C/'round3_archive/annotations.json').read_text())
 for v in V:
  a=rgb(v+'.png');old=rgb('round3/'+v+'.png');m=np.array(Image.open(R/(v+'_mask.png')).convert('L'))>127;q=np.array(Image.open(R/('guides/blockout_'+v+'_mask.png')).convert('L'))>127
  reg=rgb('regions_'+v+'.png');oldreg=rgb('round3/regions_'+v+'.png');k=np.zeros(m.shape,np.uint8)
  for i,c in enumerate(PAL):k[np.all(reg==c,axis=2)]=i
  mf=nd.binary_fill_holes(m);qf=nd.binary_fill_holes(q);e=mf^nd.binary_erosion(mf);f=qf^nd.binary_erosion(qf)
  dp,ip=nd.distance_transform_edt(~f,return_indices=True);dq,iq=nd.distance_transform_edt(~e,return_indices=True)
  hard=e&np.isin(k,[0,2,3,4]);hardq=f&np.isin(k[iq[0],iq[1]],[0,2,3,4]);hd=max(dp[hard].max(),dq[hardq].max())
  y,x=np.indices(m.shape);hood=k==5;oldhood=np.all(oldreg==[0,0,255],axis=2);d=np.any(a!=old,axis=2);dist=nd.distance_transform_edt(~oldhood)
  hm=e&hood;hmq=f&(k[iq[0],iq[1]]==5)
  hood_distance=float(max(dp[hm].max(initial=0),dq[hmq].max(initial=0))) if hm.any() or hmq.any() else None
  vals={name:np.all(oldreg==color,axis=2) for name,color in [('beak',[0,255,0]),('iris',[255,255,255]),('brow_throat',[0,255,255]),('face_lids',[255,255,0]),('body',[255,0,0])]}
  preservation[v]={'changed_pixels':int(d.sum()),'max_changed_distance_from_old_hood_px':float(dist[d].max()),'changes_by_old_material':{name:int((d&mm).sum()) for name,mm in vals.items()},'changed_beyond_6px_hood_seam':int((d&(dist>6)).sum()),'lower_body_changed':int(d[(645 if v=='top' else 500):].sum())}
  check(v+'_only_hood_and_6px_seam',not np.any(d&(dist>6)))
  check(v+'_beak_exact',not np.any(d&vals['beak']));check(v+'_iris_exact',not np.any(d&vals['iris']))
  if v in ['side','front']:
   lids=((x>=343)&(x<=405)&(y>=267)&(y<=310)) if v=='side' else poly_mask(np.where(x>627,1254-x,x),y,[[545,269],[580,266],[587,275],[585,294],[579,306],[566,313],[554,307],[547,296],[545,282]])
   preservation[v]['changed_eye_and_lid_pixels']=int((d&lids).sum());check(v+'_complete_eye_lids_exact',not np.any(d&lids))
  check(v+'_body_below_head_exact',preservation[v]['lower_body_changed']==0)
  for name,mm in vals.items():check(v+'_'+name+'_outside_seam_exact',not np.any(d&mm&(dist>6)))
  lm=previous['views'][v]['landmark_rows'].copy()
  if v!='top':lm.update(crown=bbox(m)[1],ground_contact=bbox(m)[3]-1)
  if v in ['side','back','top']:lm['nape_end']=bbox(hood)[3]-1
  results[v]={'guide_iou':float((m&q).sum()/(m|q).sum()),'paint_bbox':bbox(m),'guide_bbox':bbox(q),'paint_area_px':int(m.sum()),'guide_area_px':int(q.sum()),'external_outline_hausdorff_px':float(max(dp[e].max(),dq[f].max())), 'non_feather_outline_hausdorff_px':float(hd),'strict_10px_non_feather_pass':bool(hd<=10),'hood_outline_hausdorff_px':hood_distance,'paint_to_guide_external_max':locmax(dp,e),'guide_to_paint_external_max':locmax(dq,f),'paint_to_guide_non_feather_max':locmax(dp,hard),'guide_to_paint_non_feather_max':locmax(dq,hardq),'outline_distance_p95_px':float(np.percentile(np.r_[dp[e],dq[f]],95)), 'hood_full_material_envelope':envelope(hood),'beak_full_material_envelope':envelope(k==3),'upper_beak_width_envelope':envelope((k==3)&((y<315) if v=='front' else (y<355) if v=='top' else True)),'landmark_rows':lm,'hood_median_rgb':np.median(a[nd.binary_erosion(hood,iterations=5)],axis=0).tolist()}
  for name,value in {'canvas_1254_square':a.shape==(1254,1254,3),'binary_mask':set(np.unique(np.array(Image.open(R/(v+'_mask.png')).convert('L'))))=={0,255},'mask_exact':np.array_equal(np.any(a!=BG,axis=2),m),'background_exact':np.all(a[~m]==BG),'regions_pure':set(map(tuple,np.unique(reg.reshape(-1,3),axis=0))).issubset(set(map(tuple,PAL))),'regions_inside':np.all(reg[~m]==0),'hard_outline_within_10px':hd<=10}.items():check(v+'_'+name,value)
  if v!='side':
   for name,im in [('painting',a),('mask',m),('regions',reg)]:check(v+'_'+name+'_symmetric',sym(im))
  diagnostics[v]={'paint_outline':np.argwhere(e)[:,::-1].tolist(),'guide_outline':np.argwhere(f)[:,::-1].tolist(),'hard_paint':np.argwhere(hard)[:,::-1].tolist(),'hard_guide':np.argwhere(hardq)[:,::-1].tolist()}
 rows={}
 for name in previous['vertical_agreement']:
  values={v:results[v]['landmark_rows'].get(name) for v in V[:3]};seen=[z for z in values.values() if z is not None];spread=max(seen)-min(seen) if len(seen)>1 else None
  rows[name]={'rows':values,'spread_px':spread,'tolerance_px':19.5,'pass':None if spread is None else spread<=19.5}
  if spread is not None:check('landmark_'+name,spread<=19.5)
 comparisons=previous['projection_agreement']
 for c in comparisons:
  if c['feature']=='front_top_full_hood_envelope_width':c['a_px']=results['front']['hood_full_material_envelope']['width_px'];c['b_px']=results['top']['hood_full_material_envelope']['width_px']
  elif c['feature']=='side_top_head_including_nape_length':c['a_px']=results['side']['hood_full_material_envelope']['bbox_xyxy_exclusive'][2]-results['side']['paint_bbox'][0];c['b_px']=results['top']['hood_full_material_envelope']['bbox_xyxy_exclusive'][3]-results['top']['paint_bbox'][1]
  c['difference_percent']=100*abs(c['a_px']-c['b_px'])/min(c['a_px'],c['b_px']);c['pass']=c['difference_percent']<=3;check(c['feature'],c['pass'])
 for v in ['three_quarter','variants','head_side','head_front']:
  a=rgb(v+'.png');old=rgb('round3/'+v+'.png');d=np.any(a!=old,axis=2)
  path=S/((v[5:]+'_high_scope.png') if v.startswith('head_') else (v+'_edit_mask.png'))
  scope=np.array(Image.open(path).convert('L'))>0
  preservation[v]={'changed_pixels':int(d.sum()),'changed_outside_saved_scope':int((d&~scope).sum())};check(v+'_outside_scope_exact',not np.any(d&~scope))
  if v in ['three_quarter','variants']:
   protected_mask=np.array(Image.open(R/f'sources/round3/{v}_protected_mask.png').convert('L'))>0
   count=int((d&protected_mask).sum());preservation[v]['changed_protected_beak_iris_pixels']=count;check(v+'_beak_iris_exact',count==0)
  if v.startswith('head_'):
   view=v[5:];s=3 if view=='side' else 4;x0=90 if view=='side' else 515;y0=145;yy,xx=np.indices(d.shape);gx=(xx-40)/s+x0;gy=(yy-40)/s+y0
   lids=((gx>=343)&(gx<=405)&(gy>=267)&(gy<=310)) if view=='side' else poly_mask(np.where(gx>627,1254-gx,gx),gy,[[545,269],[580,266],[587,275],[585,294],[579,306],[566,313],[554,307],[547,296],[545,282]])
   check(v+'_complete_eye_lids_exact',not np.any(d&lids));preservation[v]['changed_eye_and_lid_pixels']=int((d&lids).sum())
 check('head_front_symmetric',sym(rgb('head_front.png'),488))
 sheet=rgb('read_sizes.png');thumbs=json.loads((C/'read_sizes.json').read_text())
 for t in thumbs:
  x,y=t['xy'];h=t['height_px'];w=t['width_px'];im=sheet[y:y+h,x:x+w];yy=np.where(np.any(im!=BG,axis=2).any(axis=1))[0];actual=int(yy[-1]-yy[0]+1);t['actual_height']=actual;check(f"read_{t['view']}_{t['silhouette']}_{h}",actual==h)
  if t['silhouette']:check('black_silhouette_'+str(h),set(map(tuple,np.unique(im.reshape(-1,3),axis=0))).issubset({tuple(BG),(0,0,0)}))
 protected=json.loads((S/'protected_hashes.json').read_text());changed=[p for p,h in protected.items() if sha(p)!=h];check('all_archives_guides_preexisting_scripts_unchanged',not changed)
 geometry=all(z['strict_10px_non_feather_pass'] for z in results.values()) and all(c['pass'] for c in comparisons) and all(z['pass'] is not False for z in rows.values())
 measures={'round':4,'canvas':[1254,1254],'scale_px_per_m':1500,'construction_origins':previous['construction_origins'],'measurement_method':previous['measurement_method'],'views':results,'vertical_agreement':rows,'projection_agreement':comparisons,'detail_counts':previous['detail_counts'],'measured_geometry_acceptance':geometry,'shared_uv_surface_projection_proof':False}
 verification={'round':4,'verified_utc':datetime.now(timezone.utc).isoformat(),'all_passed':all(checks.values()),'checks':checks,'assets':assets,'pixel_preservation':preservation,'protected_files_checked':len(protected),'changed_protected_files':changed,'thumbnails':thumbs}
 for name,data in [('measurements',measures),('final_verification',verification),('preservation',preservation),('outline_coordinates',diagnostics)]: (C/(name+'.json')).write_text(json.dumps(data,indent=2))
 print(json.dumps({'all_passed':verification['all_passed'],'failures':[k for k,v in checks.items() if not v],'guide':{v:{k:r[k] for k in ['guide_iou','non_feather_outline_hausdorff_px','hood_outline_hausdorff_px','hood_median_rgb']} for v,r in results.items()},'projection':comparisons,'landmarks':rows,'preservation':preservation},indent=2))
if __name__=='__main__':main()
