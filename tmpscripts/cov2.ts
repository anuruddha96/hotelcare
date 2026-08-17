import { generatedTranslations } from '../src/lib/generated-translations';
import { expandedTranslations } from '../src/lib/expanded-translations';
import { additionalTranslations } from '../src/lib/comprehensive-translations';
import { notificationTranslations, dashboardTranslations } from '../src/lib/notification-translations';
import { pmsTranslations } from '../src/lib/pms-translations';
import { highlightedTranslations } from '../src/lib/highlighted-translations';
import { screenTranslations } from '../src/lib/screen-translations';
import { roomOverviewTranslations } from '../src/lib/room-overview-translations';
import { purchaseInvoiceTranslations } from '../src/lib/purchase-invoice-translations';
import { locationTranslations } from '../src/lib/location-translations';
const mods:any[]=[generatedTranslations,expandedTranslations,additionalTranslations,notificationTranslations,dashboardTranslations,pmsTranslations,highlightedTranslations,screenTranslations,roomOverviewTranslations,purchaseInvoiceTranslations,locationTranslations];
const langs=['en','hu','es','vi','mn','az','tl','uk','ru'];
const flat=(s:any,p='',o:any={})=>{if(!s)return o;for(const[k,v]of Object.entries(s)){const n=p?`${p}.${k}`:k;if(v&&typeof v==='object')flat(v,n,o);else if(typeof v==='string')o[n]=v;}return o;};
const bundle=(l:string)=>Object.assign({},...mods.map(m=>flat(m[l])));
const en=bundle('en');
const res:any={};
for(const l of langs.slice(1)){const b=bundle(l);const miss=Object.keys(en).filter(k=>!b[k]);res[l]=miss.length;}
console.log('module EN keys',Object.keys(en).length, res);
