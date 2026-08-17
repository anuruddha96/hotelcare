import { generatedTranslations } from '../src/lib/generated-translations';
const langs=['en','hu','es','vi','mn','az','tl','uk','ru'];
const g:any=generatedTranslations;
const flat=(s:any,p='',o:any={})=>{if(!s)return o;for(const[k,v]of Object.entries(s)){const n=p?`${p}.${k}`:k;if(v&&typeof v==='object')flat(v,n,o);else if(typeof v==='string')o[n]=v;}return o;};
const en=flat(g.en);
for(const l of langs){const b=flat(g[l]);const missing=Object.keys(en).filter(k=>!b[k]||b[k]===en[k]);console.log(l,Object.keys(b).length,'missing/same:',missing.length);}
console.log('EN keys',Object.keys(en).length);
