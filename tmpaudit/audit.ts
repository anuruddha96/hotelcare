import { expandedTranslations } from '../src/lib/expanded-translations';
import { additionalTranslations } from '../src/lib/comprehensive-translations';
import { notificationTranslations, dashboardTranslations } from '../src/lib/notification-translations';
import { pmsTranslations } from '../src/lib/pms-translations';
import { highlightedTranslations } from '../src/lib/highlighted-translations';
import { screenTranslations } from '../src/lib/screen-translations';
import { roomOverviewTranslations } from '../src/lib/room-overview-translations';
import { purchaseInvoiceTranslations } from '../src/lib/purchase-invoice-translations';
import { locationTranslations } from '../src/lib/location-translations';
const src = await Bun.file('src/hooks/useTranslation.tsx').text();
// extract main translations object via eval of module? simpler: dynamic import
const flatten = (o: any, p=''): Record<string,string> => {
  const out: Record<string,string> = {};
  for (const [k,v] of Object.entries(o||{})) {
    const key = p?`${p}.${k}`:k;
    if (typeof v === 'string') out[key]=v; else if (v && typeof v==='object') Object.assign(out, flatten(v,key));
  }
  return out;
};
const bundles = [additionalTranslations, expandedTranslations, notificationTranslations, dashboardTranslations, pmsTranslations, highlightedTranslations, screenTranslations, roomOverviewTranslations, purchaseInvoiceTranslations, locationTranslations] as any[];
const langs = ['en','hu','es','vi','mn','uk','ru','tl','az'];
const get = (lang:string) => {
  let out: Record<string,string> = {};
  for (const b of bundles) out = {...out, ...flatten(b[lang])};
  return out;
};
const main: any = (await import('/tmp/mainobj.ts')).translations;
const full = (lang:string)=>({...flatten(main[lang]), ...get(lang)});
const en = full('en');
const res: any = {};
for (const l of langs) { if(l==='en') continue; const b = full(l); res[l] = Object.keys(en).filter(k=>!b[k] || b[k]===en[k] && false); }
console.log('EN keys', Object.keys(en).length);
for (const l of Object.keys(res)) console.log(l, 'missing', res[l].length);
await Bun.write('/tmp/missing.json', JSON.stringify({en, missing:res}, null, 0));
