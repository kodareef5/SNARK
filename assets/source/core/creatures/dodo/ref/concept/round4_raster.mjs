import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
export const S='sources/round4', BG=[214,212,206];
let seq=process.pid*100000;
export function blank(w,h,color=BG){let a=new Uint8Array(w*h*4);for(let i=0;i<a.length;i+=4){a.set(color,i);a[i+3]=255;}return {w,h,a};}
export function read(path){let raw=`${S}/io_${seq++}.raw`;let [w,h]=execFileSync(`${S}/imageio`,['decode',path,raw],{encoding:'utf8'}).trim().split(' ').map(Number);let a=new Uint8Array(fs.readFileSync(raw));fs.unlinkSync(raw);return {w,h,a};}
export function save(im,path){let raw=`${S}/io_${seq++}.raw`;fs.writeFileSync(raw,im.a);execFileSync(`${S}/imageio`,['encode',raw,String(im.w),String(im.h),path]);fs.unlinkSync(raw);}
export function pixel(im,x,y){return [...im.a.slice((y*im.w+x)*4,(y*im.w+x)*4+3)];}
export function copy(im){return {w:im.w,h:im.h,a:im.a.slice()};}
export function crop(im,box){let [x,y,xx,yy]=box,out=blank(xx-x,yy-y);for(let j=0;j<out.h;j++){out.a.set(im.a.slice(((y+j)*im.w+x)*4,((y+j)*im.w+xx)*4),j*out.w*4);}return out;}
export function paste(out,im,x,y){for(let j=0;j<im.h;j++){out.a.set(im.a.slice(j*im.w*4,(j+1)*im.w*4),((j+y)*out.w+x)*4);}return out;}
export function resize(im,w,h,nearest=false){if(im.w===w&&im.h===h)return copy(im);let a=`${S}/io_${seq++}.png`,b=`${S}/io_${seq++}.png`;save(im,a);execFileSync(`${S}/imageio`,['resize',a,String(w),String(h),b,nearest?'nearest':'high']);let out=read(b);fs.unlinkSync(a);fs.unlinkSync(b);return out;}
export function same(im,i,c=BG){return im.a[i*4]===c[0]&&im.a[i*4+1]===c[1]&&im.a[i*4+2]===c[2];}
export function rgbset(im,i,c){im.a.set(c,i*4);}
export function maskImage(m,w,h){let out=blank(w,h,[0,0,0]);for(let i=0;i<m.length;i++){let v=Math.round(m[i]*255);rgbset(out,i,[v,v,v]);}return out;}
export function symmetry(im,c){for(let y=0;y<im.h;y++)for(let x=1;x<=Math.min(c,im.w-c-1);x++){let i=(y*im.w+c+x)*4,j=(y*im.w+c-x)*4;im.a.set(im.a.slice(j,j+4),i);}return im;}
export function boxOf(im){let x0=im.w,y0=im.h,x1=0,y1=0;for(let y=0;y<im.h;y++)for(let x=0;x<im.w;x++)if(!same(im,y*im.w+x)){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x+1);y1=Math.max(y1,y+1);}return [x0,y0,x1,y1];}
export function contact(images,path,cols=4,tile=500){let out=blank(cols*tile,Math.ceil(images.length/cols)*tile);images.forEach((im,i)=>{let s=Math.min(tile/im.w,tile/im.h);let q=resize(im,Math.round(im.w*s),Math.round(im.h*s));paste(out,q,i%cols*tile+Math.floor((tile-q.w)/2),Math.floor(i/cols)*tile+Math.floor((tile-q.h)/2));});save(out,path);}
export function inside(x,y,pts){let b=false;for(let i=0,j=pts.length-1;i<pts.length;j=i++){let [xi,yi]=pts[i],[xj,yj]=pts[j];if(((yi>y)!=(yj>y))&&(x<(xj-xi)*(y-yi)/(yj-yi)+xi))b=!b;}return b;}
// Chamfer distances only control small seam blends; audited outline distances use exact Euclidean scipy EDT.
export function distance(m,w,h){let d=Float32Array.from(m,v=>v?0:1e6);const rt=Math.SQRT2;
for(let y=0;y<h;y++)for(let x=0;x<w;x++){let i=y*w+x;if(x)d[i]=Math.min(d[i],d[i-1]+1);if(y)d[i]=Math.min(d[i],d[i-w]+1);if(x&&y)d[i]=Math.min(d[i],d[i-w-1]+rt);if(x<w-1&&y)d[i]=Math.min(d[i],d[i-w+1]+rt);}
for(let y=h-1;y>=0;y--)for(let x=w-1;x>=0;x--){let i=y*w+x;if(x<w-1)d[i]=Math.min(d[i],d[i+1]+1);if(y<h-1)d[i]=Math.min(d[i],d[i+w]+1);if(x<w-1&&y<h-1)d[i]=Math.min(d[i],d[i+w+1]+rt);if(x&&y<h-1)d[i]=Math.min(d[i],d[i+w-1]+rt);}return d;}
if(process.argv[2]==='prepare'){
 let p=read('round3/three_quarter.png');save(resize(crop(p,[250,125,685,510]),1305,1155),`${S}/three_quarter_input.png`);
 let v=read('round3/variants.png'),out=blank(1440,760);let offsets=[[0,0],[460,0],[923,0],[0,500],[460,500],[923,500]];
 offsets.forEach(([x,y],i)=>paste(out,resize(crop(v,[100+x,10+y,340+x,200+y]),480,380),i%3*480,Math.floor(i/3)*380));save(out,`${S}/variants_input.png`);
}
