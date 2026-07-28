const en = await Bun.file('/tmp/newkeys.json').json();
const KEY = process.env.LOVABLE_API_KEY!;
const NAMES: Record<string,string> = { hu:'Hungarian', es:'Spanish', vi:'Vietnamese', mn:'Mongolian', uk:'Ukrainian', ru:'Russian', tl:'Filipino (Tagalog)', az:'Azerbaijani' };
const out: Record<string, Record<string,string>> = {};
await Promise.all(Object.keys(NAMES).map(async lang => {
  for (let a=0;a<4;a++){
    const res = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', { method:'POST', headers:{Authorization:`Bearer ${KEY}`,'Content-Type':'application/json'}, body: JSON.stringify({ model:'google/gemini-2.5-flash', messages:[{role:'system',content:`Translate hotel housekeeping app UI strings into ${NAMES[lang]}. Return ONLY a JSON object with the same keys. Keep placeholders like {count} intact.`},{role:'user',content:JSON.stringify(en)}], response_format:{type:'json_object'} }) });
    if (!res.ok) { await new Promise(r=>setTimeout(r,3000*(a+1))); continue; }
    const j = await res.json();
    try { out[lang] = JSON.parse(j.choices[0].message.content); return; } catch {}
  }
}));
await Bun.write('/tmp/gen/newkeys.json', JSON.stringify(out));
console.log(Object.keys(out).map(l=>l+':'+Object.keys(out[l]).length).join(' '));
