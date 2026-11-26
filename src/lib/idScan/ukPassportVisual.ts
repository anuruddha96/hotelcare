import type { Gray, CodeGeometry } from './codeLineRefine';
import type { MrzReadResult } from './mrz';
import { passportBirthplaceKey, type BirthplaceRowRead } from './passportBirthPlace';

export const ukLegacyRegions = {
  value: [-.068,-.299,.114,-.266],
  surname: [-.19,-.537,.003,-.499],
  expiry: [-.185,-.187,.100,-.151],
} as const;
type Region = readonly [number,number,number,number];
const cubic = (x:number) => {const t=Math.abs(x); return t<=1 ? (1.25*t-2.25)*t*t+1 : t<2 ? ((-.75*t+3.75)*t-6)*t+3 : 0;};

/** Tight blue-channel crop at native detail, enlarged using bicubic interpolation.
 * The small security-patterned value is not a whole-page text block. */
export function sampleUkRegion(source:Gray,g:CodeGeometry,region:Region):Gray {
  const [u0,v0,u1,v1]=region.map(n=>n*g.width);
  const width=Math.min(1400,Math.max(8,Math.round((u1-u0)*4)));
  const height=Math.max(8,Math.round(width*(v1-v0)/(u1-u0)));
  const data=new Uint8ClampedArray(width*height);
  const a=g.angle*Math.PI/180,c=Math.cos(a),s=Math.sin(a);
  for(let y=0;y<height;y++) for(let x=0;x<width;x++){
    const u=u0+(u1-u0)*x/Math.max(1,width-1),v=v0+(v1-v0)*y/Math.max(1,height-1);
    const sx=Math.round((g.cx+u*c-v*s)*32)/32,sy=Math.round((g.cy+u*s+v*c)*32)/32,ix=Math.floor(sx),iy=Math.floor(sy);
    let sum=0,weights=0;
    for(let dy=-1;dy<=2;dy++) for(let dx=-1;dx<=2;dx++){
      const weight=cubic(sx-ix-dx)*cubic(sy-iy-dy);
      const px=Math.max(0,Math.min(source.width-1,ix+dx)),py=Math.max(0,Math.min(source.height-1,iy+dy));
      sum+=weight*source.data[py*source.width+px];weights+=weight;
    }
    data[y*width+x]=sum/weights;
  }
  return {data,width,height};
}

/** CLAHE: clipped local histograms on 4x4 tiles, bilinearly interpolated.
 * This suppresses coloured security backgrounds while retaining dark letters. */
export function localPassportContrast(image:Gray):Gray {
  const {width,height,data}=image, nx=4,ny=4;
  const padded = width%nx!==0 || height%ny!==0;
  const tw=padded?(width+nx-width%nx)/nx:width/nx,th=padded?(height+ny-height%ny)/ny:height/ny;
  const reflect=(p:number,n:number)=>p<n?p:Math.max(0,2*n-p-2);
  const maps:Uint8Array[]=[];
  for(let ty=0;ty<ny;ty++) for(let tx=0;tx<nx;tx++){
    const hist=new Uint32Array(256),n=tw*th;
    for(let y=0;y<th;y++) for(let x=0;x<tw;x++){
      const px=reflect(tx*tw+x,width),py=reflect(ty*th+y,height);
      hist[data[py*width+px]]++;
    }
    const limit=Math.max(1,Math.floor(2.5*n/256));let excess=0;
    for(let i=0;i<256;i++) if(hist[i]>limit){excess+=hist[i]-limit;hist[i]=limit;}
    const batch=Math.floor(excess/256),rest=excess%256;
    for(let i=0;i<256;i++)hist[i]+=batch;
    for(let i=0;i<rest;i++)hist[i*Math.max(1,Math.floor(256/rest))]++;
    let total=0;const lut=new Uint8Array(256);
    for(let i=0;i<256;i++){total+=hist[i];lut[i]=Math.min(255,Math.round(total*255/n));}maps.push(lut);
  }
  const out=new Uint8ClampedArray(data.length);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const gx=x/tw-.5,gy=y/th-.5,ix=Math.floor(gx),iy=Math.floor(gy),fx=gx-ix,fy=gy-iy;
    const at=(tx:number,ty:number)=>maps[Math.max(0,Math.min(ny-1,ty))*nx+Math.max(0,Math.min(nx-1,tx))][data[y*width+x]];
    out[y*width+x]=(at(ix,iy)*(1-fx)+at(ix+1,iy)*fx)*(1-fy)+(at(ix,iy+1)*(1-fx)+at(ix+1,iy+1)*fx)*fy;
  }
  return {data:out,width,height};
}

export function passportOtsu(image:Gray):Gray {
  const hist=new Uint32Array(256);let total=0;
  for(const n of image.data){hist[n]++;total+=n;}
  let left=0,sum=0,best=-1,threshold=0;
  for(let i=0;i<256;i++){left+=hist[i];sum+=i*hist[i];const right=image.data.length-left;if(!left||!right)continue;
    const score=left*right*(sum/left-(total-sum)/right)**2;if(score>best){best=score;threshold=i;}}
  return {...image,data:Uint8ClampedArray.from(image.data,n=>n<=threshold?0:255)};
}

const months=['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
function expiryMatches(text:string,date:string|null):boolean {
  if(!date)return false;
  const [year,month,day]=date.split('-');
  const tokens=text.toUpperCase().match(/[A-Z]+|\d+/g)??[];
  return tokens[0]===day && tokens.includes(months[Number(month)-1]) &&
    (tokens.at(-1)===year.slice(-2)||tokens.at(-1)===year);
}

/** Alternative evidence when the fine-print field label is unreadable:
 * confirm the legacy layout from two separately located printed values
 * (surname and expiry date) against the valid MRZ before proposing a
 * value from the narrow birthplace position. Never derive a city from MRZ. */
export function verifiedLegacyBirthplace(result:MrzReadResult,surname:BirthplaceRowRead,expiry:BirthplaceRowRead,reads:BirthplaceRowRead[]):string|undefined {
  if(!result.valid||result.unknownCountry||result.format!=='TD3'||result.fields.issuingState!=='GBR')return;
  if((surname.confidence??0)<45||(expiry.confidence??0)<60||
    passportBirthplaceKey(surname.text.trim())!==passportBirthplaceKey(result.fields.mrzLastName)||
    !expiryMatches(expiry.text,result.fields.expiryDate))return;
  const candidates=reads.filter(r=>(r.confidence??0)>=65).map(r=>r.text.trim())
    .filter(s=>/^[\p{L}\p{M}][\p{L}\p{M} .,'’()-]{1,79}$/u.test(s)&&
      !/\b(?:authority|passport|surname|nationality|birth|expiry|unknown|specimen)\b/i.test(s));
  if(!candidates.length||!candidates.every(s=>passportBirthplaceKey(s)===passportBirthplaceKey(candidates[0])))return;
  return candidates[0].toLowerCase().replace(/(^|[\s,('’\-])\p{L}/gu,c=>c.toUpperCase());
}
