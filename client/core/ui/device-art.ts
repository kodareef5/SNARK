// Original controller geometry. One body and two reusable rings support both stick layouts without another atlas.
export const PAD_X=64, PAD_Y=256, PAD_WIDTH=384, PAD_HEIGHT=192;
export const RING_X=448, RING_Y=256, STICK_Y=320;

export function devicePixels(data: Uint8ClampedArray, stride: number): void {
  const put=(x:number,y:number,edge:number,body:number):void=>{
    const a=body*144+edge*224, mix=a>0?edge*224/a:0, p=(y*stride+x)*4;
    data[p]=15+119*mix;data[p+1]=39+145*mix;data[p+2]=57+149*mix;data[p+3]=a;
  };
  const shape=(x:number,y:number):boolean=>{
    const u=x*2;
    if(((u-1)/.83)**2+((y-.44)/.38)**2<1)return true;
    for(const side of [-1,1]) {
      const dx=u-(1+side*.65),dy=y-.61;
      const a=dx*.96-dy*side*.28,b=dx*side*.28+dy*.96;
      if((a/.23)**2+(b/.37)**2<1)return true;
    }
    return false;
  };
  const mask=new Float32Array(PAD_WIDTH*PAD_HEIGHT);
  for(let y=0;y<PAD_HEIGHT;y++)for(let x=0;x<PAD_WIDTH;x++) {
    let n=0;for(let j=0;j<2;j++)for(let i=0;i<2;i++)if(shape((x+(i+.5)/2)/PAD_WIDTH,(y+(j+.5)/2)/PAD_HEIGHT))n++;
    mask[y*PAD_WIDTH+x]=n/4;
  }
  for(let y=1;y<PAD_HEIGHT-1;y++)for(let x=1;x<PAD_WIDTH-1;x++) {
    const p=y*PAD_WIDTH+x,coverage=mask[p]!;
    const edge=Math.max(0,coverage-Math.min(mask[p-1]!,mask[p+1]!,mask[p-PAD_WIDTH]!,mask[p+PAD_WIDTH]!));
    put(PAD_X+x,PAD_Y+y,edge,coverage-edge);
  }
  for(let y=0;y<64;y++)for(let x=0;x<64;x++) {
    const r=Math.hypot(x-31.5,y-31.5),outer=Math.max(0,Math.min(1,28.5-r)),inner=Math.max(0,Math.min(1,26.5-r));
    put(RING_X+x,RING_Y+y,outer-inner,inner*.65);
    const inset=Math.max(0,Math.min(1,22.5-r))-Math.max(0,Math.min(1,21.5-r));
    put(RING_X+x,STICK_Y+y,Math.max(outer-inner,inset*.35),inner*.9-inset*.35);
  }
}
