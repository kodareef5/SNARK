import fs from 'node:fs';
import {BG,read,save,blank,copy,crop,paste,resize,same,rgbset,contact} from './round4_raster.mjs';
const V=['side','front','back','top'],S='sources/round4',C='checks';
const coords=JSON.parse(fs.readFileSync(`${C}/outline_coordinates.json`)),m=JSON.parse(fs.readFileSync(`${C}/measurements.json`));
const boxes={side:[90,145,575,480],front:[515,145,740,475],back:[515,145,740,485],top:[515,330,740,645],three_quarter:[250,125,685,510]};
function mark(im,points,color){for(let [x,y] of points)if(x>=0&&y>=0&&x<im.w&&y<im.h)rgbset(im,y*im.w+x,color);}
function line(im,x0,y0,x1,y1,c){let n=Math.max(Math.abs(x1-x0),Math.abs(y1-y0));for(let i=0;i<=n;i++){let x=Math.round(x0+(x1-x0)*i/n),y=Math.round(y0+(y1-y0)*i/n);if(x>=0&&y>=0&&x<im.w&&y<im.h)rgbset(im,y*im.w+x,c);}}
let overlays=[],hard=[],diffs=[],landmarks=[],pairs=[];
for(let v of V){let a=read(v+'.png'),ov=copy(a),h=copy(a);
 mark(ov,coords[v].guide_outline,[244,54,84]);mark(ov,coords[v].paint_outline,[0,155,196]);save(ov,`${C}/guide_overlay_${v}.png`);overlays.push(ov);
 mark(h,coords[v].paint_outline,[75,130,180]);mark(h,coords[v].hard_paint,[0,230,70]);mark(h,coords[v].hard_guide,[230,70,30]);hard.push(h);
 let lm=copy(a);for(let y of Object.values(m.views[v].landmark_rows)){if(y!==null)line(lm,0,y,1253,y,[190,60,60]);}line(lm,v==='side'?640:627,0,v==='side'?640:627,1253,[38,100,160]);landmarks.push(lm);
 pairs.push(crop(a,boxes[v]),crop(read('regions_'+v+'.png'),boxes[v]));
}
contact(overlays,`${C}/guide_overlays.png`,4,800);contact(hard,`${C}/non_feather_outline.png`,4,800);contact(landmarks,`${C}/landmark_overlays.png`,4,800);contact(pairs,`${C}/head_regions_inspection.png`,4,650);
for(let v of [...V,'three_quarter','variants']){let a=read(v+'.png'),old=read('round3/'+v+'.png'),d=copy(old);
 for(let i=0;i<a.w*a.h;i++){let changed=false;for(let c=0;c<3;c++)if(a.a[i*4+c]!==old.a[i*4+c])changed=true;
  for(let c=0;c<3;c++)d.a[i*4+c]=Math.round(old.a[i*4+c]*.4+BG[c]*.6);if(changed)rgbset(d,i,[205,30,90]);
 }save(d,`${C}/preservation_${v}.png`);diffs.push(d);
}
contact(diffs,`${C}/preservation_contact.png`,3,600);
let eyes=[];for(let v of ['side','front'])for(let prefix of ['round3/',''])eyes.push(crop(read(prefix+v+'.png'),v==='side'?[330,260,430,330]:[535,260,595,330]));contact(eyes,`${C}/eye_comparison.png`,4,600);
for(let v of [...V,'three_quarter','head_side','head_front','variants','read_sizes']){let a=read(v+'.png');let s=Math.min(1,1500/a.w,1500/a.h);save(resize(a,Math.round(a.w*s),Math.round(a.h*s)),`${C}/review_${v}.png`);}
for(let v of ['back','top','three_quarter']){let a=crop(read(v+'.png'),boxes[v]);save(resize(a,900,Math.round(a.h*900/a.w)),`${C}/review_${v}_hood.png`);}
let variants=read('variants.png'),vi=[];for(let [x,y] of [[0,0],[460,0],[923,0],[0,500],[460,500],[923,500]])vi.push(crop(variants,[190+x,10+y,335+x,170+y]));contact(vi,`${C}/variant_hoods.png`,3,600);
let ann=JSON.parse(fs.readFileSync(`${C}/round3_archive/annotations.json`));ann.round=4;ann.points.side.nape_end[1]=m.views.side.landmark_rows.nape_end;ann.points.back.nape_end[1]=m.views.back.landmark_rows.nape_end;ann.points.top.nape_end[1]=m.views.top.landmark_rows.nape_end;
fs.writeFileSync(`${C}/annotations.json`,JSON.stringify(ann,null,2));
fs.writeFileSync(`${C}/detail_counts.json`,JSON.stringify({...m.detail_counts,round:4,basis:'Round-3 body and markings preserved exactly outside hood edge seams; no count or placement edits.'},null,2));
fs.writeFileSync(`${C}/transforms.json`,JSON.stringify({round:4,full_canvas_transform:'identity',scale_px_per_m:1500,bilateral_reflection_column:627,source:'sources/round4/assembly.json',head_closeups:'Same source masters used in the orthographic hood composites; original accepted non-hood detail pixels retained.',anatomical_warp:false},null,2));
let verify=JSON.parse(fs.readFileSync(`${C}/final_verification.json`));fs.writeFileSync(`${C}/pixel_checks.json`,JSON.stringify(verify.checks,null,2));
// Old generic check names are archived; keep only diagnostic images regenerated this round.
const stale=['beak_boundary_inspection.png','detail_layout.png','foot_inspection.png','horizontal_guides.png','projection_overlays.png'];
for(let f of stale)if(fs.existsSync(`${C}/round3_archive/${f}`)&&fs.existsSync(`${C}/${f}`))fs.unlinkSync(`${C}/${f}`);
console.log('Current-round review and comparison sheets written.');
