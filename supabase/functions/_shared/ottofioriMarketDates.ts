const day = 86_400_000;
const add = (today: string,n:number) => new Date(Date.parse(today+'T00:00:00Z')+n*day).toISOString().slice(0,10);

/** Keep the paid date count at <=60 while reaching the full weak winter months. */
export function ottofioriMarketDates(today: string, requested?: unknown): string[] {
  const end=add(today,120);
  if(requested!==undefined) {
    if(!Array.isArray(requested) || requested.length===0 || requested.length>60) throw new Error('Request 1–60 market dates');
    const dates=requested.map(d=>{
      if(typeof d!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(d) || d<today || d>end
        || !Number.isFinite(Date.parse(d+'T00:00:00Z')) || new Date(d+'T00:00:00Z').toISOString().slice(0,10)!==d) throw new Error('Invalid market date');
      return d;
    });
    return [...new Set(dates)].sort();
  }
  const all=Array.from({length:121},(_,i)=>add(today,i));
  const chosen=new Set(all.slice(0,14));
  for(const date of all) if(['11','01'].includes(date.slice(5,7)) && chosen.size<60) chosen.add(date);
  const rotation=Math.floor(Date.parse(today+'T00:00:00Z')/day)%all.length;
  for(let i=0;chosen.size<60 && i<all.length;i++) chosen.add(all[(rotation+i*7)%all.length]);
  return [...chosen].sort();
}
