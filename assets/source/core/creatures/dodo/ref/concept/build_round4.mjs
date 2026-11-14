// Frozen image_gen paintings; local compositing only, no procedural painted texture.
import fs from 'node:fs';
import {S,BG,blank,read,save,pixel,copy,crop,paste,resize,same,rgbset,maskImage,symmetry,boxOf,contact,inside,distance} from './round4_raster.mjs';
const views=['side','front','back','top'];
const specs={side:{box:[90,145,575,480],scale:3,pad:40},front:{box:[515,145,740,475],scale:4,pad:40},back:{box:[515,145,740,485],scale:4,pad:0},top:{box:[515,330,740,645],scale:4,pad:0},three_quarter:{box:[250,125,685,510],scale:3,pad:0}};
const clamp=(x)=>Math.max(0,Math.min(1,x));
function eyeLids(v,x,y){
 if(v==='side')return x>=343&&x<=405&&y>=267&&y<=310;
 if(v==='front'){
  let xx=x>627?1254-x:x;
  return inside(xx,y,[[545,269],[580,266],[587,275],[585,294],[579,306],[566,313],[554,307],[547,296],[545,282]]);
 }
 return false;
}
function hoodColor(a,i){let [r,g,b]=a.slice(i*4,i*4+3);return r<160&&r-g>3&&g-b>1;}
function foreground(a,i){let [r,g,b]=a.slice(i*4,i*4+3);return (r+g+b)/3<185||r-b>23;}
function growMask(im,region,v){let m=new Uint8Array(im.w*im.h),regionDist;
if(region){let seed=Uint8Array.from(m,(_,i)=>same(region,i,[0,0,255])?1:0);regionDist=distance(seed,im.w,im.h);}
for(let i=0;i<m.length;i++){
 let x=i%im.w,y=Math.floor(i/im.w),ok;
 if(region)ok=regionDist[i]<=2*specs[v].scale&&hoodColor(im.a,i)&&!same(im,i);
 else {let gx=x/3+250,gy=y/3+125;
  const p=[[416,223],[421,202],[440,178],[469,160],[499,144],[548,142],[583,148],[620,164],[647,192],[661,221],[666,262],[663,339],[652,392],[630,433],[620,418],[621,367],[619,329],[613,304],[603,290],[590,283],[575,287],[571,280],[578,268],[578,258],[568,247],[548,235],[522,227],[499,224],[480,229],[465,238],[461,243],[451,231],[435,226],[417,233]];
  ok=inside(gx,gy,p)&&hoodColor(im.a,i);
 }
 m[i]=ok?1:0;
}return m;}
function localEdit(old,gen,region,v,scale){
 let {w,h}=old,hood=growMask(old,region,v),d=distance(hood,w,h),alpha=new Float32Array(w*h),out=copy(old);
 let oldbg=Uint8Array.from(hood,(_,i)=>same(old,i)?1:0),dbg=distance(oldbg,w,h);
 for(let i=0;i<alpha.length;i++){
  let isHood=hood[i]===1,newHood=hoodColor(gen.a,i),newFg=foreground(gen.a,i),oldFg=!same(old,i);
  let protectedMaterial=region&&(same(region,i,[255,255,255])||(same(region,i,[0,255,0])&&(!isHood||old.a[i*4]>=90)));
  let x=i%w,y=Math.floor(i/w),allow=0;
  if(specs[v]&&eyeLids(v,(x-specs[v].pad)/scale+specs[v].box[0],(y-specs[v].pad)/scale+specs[v].box[1]))continue;
  if(protectedMaterial)continue;
  if(isHood)allow=1;
  else if(newHood && d[i]<=3*scale)allow=clamp((3*scale+1-d[i])/(1.2*scale));
  // Never repaint non-feather surfaces just because a generated crop moved them.
  // New feather tips may overlap only the narrow existing material boundary.
  if(!isHood&&!newHood){
   if(oldFg&&!newFg&&d[i]<=3*scale)allow=1;
   else if(oldFg&&newFg&&d[i]<1.25*scale)allow=clamp((1.25*scale-d[i])/scale);
   else continue;
  }
  if(isHood&&!newHood&&newFg){
    // Newly opened minute gaps use original generated underlying colour only on seam.
    let nonHoodNear=d[i]; // Hood membership is the primary approved region.
    allow=1;
  }
  if(!oldFg&&!newFg)continue;
  // Only a tiny outline fringe: keep crown/width stable and never paste backdrop gradients.
  if(!oldFg&&d[i]>scale)continue;
  let rgb=newFg?[gen.a[i*4],gen.a[i*4+1],gen.a[i*4+2]]:BG;
  for(let c=0;c<3;c++)out.a[i*4+c]=Math.round(old.a[i*4+c]*(1-allow)+rgb[c]*allow);
  alpha[i]=allow;
 }
 if(v!=='side'&&v!=='three_quarter'){
  let c=(627-specs[v].box[0])*scale+specs[v].pad;symmetry(out,c);
  let am=symmetry(maskImage(alpha,w,h),c);alpha=Float32Array.from(alpha,(_,i)=>am.a[i*4]/255);
 }
 return {out,alpha,hood};
}
function ortho(v){
 let sp=specs[v],{box,scale,pad}=sp,w=(box[2]-box[0])*scale,h=(box[3]-box[1])*scale;
 let old=read(v==='side'||v==='front'?`round3/head_${v}.png`:`sources/round3/${v}_head_master.png`);
 let gen=resize(read(`${S}/${v}2_edit.png`),old.w,old.h);
 if(v==='front'){
  // The final generated repair supplies only the narrow forehead seam;
  // the original horn and brow shelf remain registered and protected.
  let fix=resize(read(`${S}/front4_edit.png`),old.w,old.h);
  for(let y=320;y<428;y++)for(let x=290;x<688;x++){
   let a=clamp((y-320)/18)*clamp((428-y)/12)*clamp((x-290)/24)*clamp((688-x)/24),i=(y*gen.w+x)*4,j=(y*fix.w+x)*4;
   for(let c=0;c<3;c++)gen.a[i+c]=Math.round(gen.a[i+c]*(1-a)+fix.a[j+c]*a);
  }
 }
 let oldreg=read(`round3/regions_${v}.png`),reg=blank(old.w,old.h,[0,0,0]);paste(reg,resize(crop(oldreg,box),w,h,true),pad,pad);
 let {out,alpha,hood}=localEdit(old,gen,reg,v,scale);save(out,`${S}/${v}_head_master.png`);save(maskImage(alpha,out.w,out.h),`${S}/${v}_high_scope.png`);
 if(v==='side'||v==='front')save(out,`head_${v}.png`);
 let full=read(`round3/${v}.png`),original=copy(full),small=resize(crop(out,[pad,pad,pad+w,pad+h]),w/scale,h/scale),
 aSmall=resize(crop(maskImage(alpha,out.w,out.h),[pad,pad,pad+w,pad+h]),w/scale,h/scale),scope=new Float32Array(full.w*full.h);
 for(let yy=0;yy<small.h;yy++)for(let xx=0;xx<small.w;xx++){
  let i=(yy+box[1])*full.w+xx+box[0],j=yy*small.w+xx,al=aSmall.a[j*4]/255;
  if(same(oldreg,i,[0,255,0])||same(oldreg,i,[255,255,255])||eyeLids(v,xx+box[0],yy+box[1]))al=0;
  if(al>0){for(let c=0;c<3;c++)full.a[i*4+c]=Math.round(full.a[i*4+c]*(1-al)+small.a[j*4+c]*al);scope[i]=al;
   if(!foreground(full.a,i))rgbset(full,i,BG);
  }
 }
 if(v!=='side'){symmetry(full,627);scope=Float32Array.from(scope,(_,i)=>symScopeVal(scope,full.w,i,627));}
 save(full,`${v}.png`);save(maskImage(scope,full.w,full.h),`${S}/${v}_edit_mask.png`);
 let mask=new Float32Array(scope.length),newreg=copy(oldreg),protectedMask=new Float32Array(scope.length);
 for(let i=0;i<mask.length;i++){
  mask[i]=same(full,i)?0:1;
  protectedMask[i]=scope[i]===0?1:0;
  if(!mask[i])rgbset(newreg,i,[0,0,0]);
  else if(scope[i]>0 && (hoodColor(full.a,i)||same(oldreg,i,[0,0,0])))rgbset(newreg,i,[0,0,255]);
  else if(scope[i]>0 && same(newreg,i,[0,0,255])&&!hoodColor(full.a,i)){
   let [r,g,b]=pixel(full,i%full.w,Math.floor(i/full.w));
   rgbset(newreg,i,r-g>25?(g-b>35?[0,255,255]:[255,255,0]):[255,0,0]);
  }
 }
 save(maskImage(mask,full.w,full.h),`${v}_mask.png`);save(newreg,`regions_${v}.png`);save(maskImage(protectedMask,full.w,full.h),`${S}/${v}_protected_mask.png`);
 return full;
}
function symScopeVal(a,w,i,c){let x=i%w;return x>c&&2*c-x>=0?a[i-x+2*c-x]:a[i];}
function perspective(){let v='three_quarter',box=specs[v].box,old=read(`${S}/${v}_input.png`),gen=resize(read(`${S}/${v}2_edit.png`),old.w,old.h),{out,alpha}=localEdit(old,gen,null,v,3);
 save(out,`${S}/${v}_head_master.png`);let full=read(`round3/${v}.png`),small=resize(out,435,385),al=resize(maskImage(alpha,out.w,out.h),435,385),scope=new Float32Array(full.w*full.h);
 for(let y=0;y<385;y++)for(let x=0;x<435;x++){let i=(y+125)*full.w+x+250,j=y*435+x,a=al.a[j*4]/255;if(a){for(let c=0;c<3;c++)full.a[i*4+c]=Math.round(full.a[i*4+c]*(1-a)+small.a[j*4+c]*a);scope[i]=a;if(!foreground(full.a,i))rgbset(full,i,BG);}}
 let original=read(`round3/${v}.png`),protectedMask=read(`sources/round3/${v}_protected_mask.png`);
 for(let i=0;i<scope.length;i++)if(protectedMask.a[i*4]>127){rgbset(full,i,pixel(original,i%full.w,Math.floor(i/full.w)));scope[i]=0;}
 save(full,`${v}.png`);save(maskImage(scope,full.w,full.h),`${S}/${v}_edit_mask.png`);return full;
}
function variants(){let base=read('round3/variants.png'),edited=resize(read(`${S}/variants_edit.png`),1440,760),scope=new Float32Array(base.w*base.h);
 let offsets=[[0,0],[460,0],[923,0],[0,500],[460,500],[923,500]];
 // Hood border follows accepted six side portraits, excluding eye, brow, cheek and neck.
 let pts=[[204,52],[209,39],[226,25],[252,20],[279,25],[304,43],[321,70],[325,104],[318,139],[305,157],[300,140],[296,113],[293,97],[280,91],[268,88],[260,88],[267,80],[270,74],[263,66],[242,61],[215,63]];
 offsets.forEach(([ox,oy],n)=>{
  let old=crop(base,[100+ox,10+oy,340+ox,200+oy]),gen=resize(crop(edited,[n%3*480,Math.floor(n/3)*380,n%3*480+480,Math.floor(n/3)*380+380]),240,190);
  let support=Uint8Array.from({length:240*190},(_,i)=>inside(i%240+100,Math.floor(i/240)+10,pts)?1:0),d=distance(support,240,190);
  for(let y=0;y<190;y++)for(let x=0;x<240;x++){let j=y*240+x,i=(y+oy+10)*base.w+x+ox+100;
   if(d[j]>4)continue;
   let allow=support[j]?1:clamp((2.5-d[j])/2);
   // Background fringe is permitted only beside existing hood.
   let c=foreground(gen.a,j)?pixel(gen,x,y):BG;
   if(!same(old,j)&&!foreground(gen.a,j))allow=1;
   for(let ch=0;ch<3;ch++)base.a[i*4+ch]=Math.round(old.a[j*4+ch]*(1-allow)+c[ch]*allow);scope[i]=allow;
  }
 });
 let original=read('round3/variants.png'),protectedMask=read('sources/round3/variants_protected_mask.png');
 for(let i=0;i<scope.length;i++)if(protectedMask.a[i*4]>127){rgbset(base,i,pixel(original,i%base.w,Math.floor(i/base.w)));scope[i]=0;}
 save(base,'variants.png');save(maskImage(scope,base.w,base.h),`${S}/variants_edit_mask.png`);return base;}
function reads(side,persp){let out=blank(540,348),meta=[],yt=12;for(let h of [128,48,16]){
 for(let col=0;col<3;col++){let v=col===1?'three_quarter':'side',im=copy(col===1?persp:side),b=boxOf(im);im=crop(im,b);
 if(col===2)for(let i=0;i<im.w*im.h;i++)if(!same(im,i))rgbset(im,i,[0,0,0]);
 let w=Math.round(im.w*h/im.h),small=resize(im,w,h,col===2),x=col*180+Math.floor((180-w)/2);
 if(col===2)for(let i=0;i<w*h;i++)rgbset(small,i,same(small,i)?BG:[0,0,0]);
 paste(out,small,x,yt);meta.push({view:v,silhouette:col===2,height_px:h,width_px:w,xy:[x,yt]});
 }yt+=h+28;
 }save(out,'read_sizes.png');fs.writeFileSync('checks/read_sizes.json',JSON.stringify(meta,null,2));return out;}
let mode=process.argv[2]||'all';
if(mode==='ortho'||mode==='all'){for(let v of views)ortho(v);}
if(views.includes(mode))ortho(mode);
if(mode==='perspective'||mode==='all')perspective();
if(mode==='variants'||mode==='all')variants();
if(mode==='sheets'||mode==='all'){
 // checks/ is remade, not kept in the repo; the earlier rounds' heads are not kept either.
 fs.mkdirSync('checks',{recursive:true});
 let ims=views.map(v=>read(`${v}.png`)),persp=read('three_quarter.png'),sizes=reads(ims[0],persp);
 contact(ims,'checks/orthographic_contact.png');contact(views.map(v=>read(`regions_${v}.png`)),'checks/regions_contact.png');contact(views.map(v=>read(`${v}_mask.png`)),'checks/masks_contact.png');
 contact([...ims,persp,read('head_side.png'),read('head_front.png'),read('variants.png'),sizes],'checks/all_paintings_contact.png');
 contact([...views.map(v=>crop(read(`${v}.png`),specs[v].box)),crop(persp,specs.three_quarter.box)],'checks/head_comparison.png',3,700);
 if(['round1','round2'].every(p=>fs.existsSync(p))){
 contact(['round1','round2','round3','.'].map(p=>read(`${p}/head_side.png`)),'checks/hood_evolution_side.png',2,1000);
 contact(['round1','round2','round3','.'].map(p=>read(`${p}/head_front.png`)),'checks/hood_evolution_front.png',4,650);
 }
}
fs.writeFileSync(`${S}/assembly.json`,JSON.stringify({round:4,base:'round3',specs,transforms:'Original full-canvas identity; uniform crop scaling; symmetry about existing centre; generated pixels composited only within hood and narrow feather-edge seam.',painting:'Retained image_gen PNGs only; no procedural textures.'},null,2));
