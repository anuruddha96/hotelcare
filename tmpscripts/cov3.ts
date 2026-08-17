import { inlineTranslations as T } from './inline';
const langs=['hu','es','vi','mn','az','tl','uk','ru'];
const en=Object.keys(T.en);
for(const l of langs){const b=T[l]||{};const miss=en.filter(k=>!(k in b));console.log(l,'have',Object.keys(b).length,'missing',miss.length);}
console.log('EN',en.length);
