const { en, missing } = await Bun.file('/tmp/missing.json').json();
const KEY = process.env.LOVABLE_API_KEY!;
const NAMES: Record<string,string> = { hu:'Hungarian', es:'Spanish', vi:'Vietnamese', mn:'Mongolian', uk:'Ukrainian', ru:'Russian', tl:'Filipino (Tagalog)', az:'Azerbaijani' };
const chunk = <T,>(a:T[], n:number) => Array.from({length: Math.ceil(a.length/n)}, (_,i)=>a.slice(i*n,(i+1)*n));

async function translate(lang: string, keys: string[], attempt = 0): Promise<Record<string,string>> {
  const src: Record<string,string> = {};
  for (const k of keys) src[k] = en[k];
  const res = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash',
      messages: [
        { role: 'system', content: `You translate UI strings for a hotel housekeeping/management app into ${NAMES[lang]}. Return ONLY a JSON object mapping every input key to its translated string. Keep placeholders like {name}, {count}, {{x}}, %s, HTML and emoji intact. Keep short labels short. Do not translate brand names (Previo, Hotel Care, PMS, DND can stay as widely-known abbreviation if natural).` },
        { role: 'user', content: JSON.stringify(src) },
      ],
      response_format: { type: 'json_object' },
    }),
  });
  if (!res.ok) {
    if (attempt < 4) { await new Promise(r=>setTimeout(r, 3000*(attempt+1))); return translate(lang, keys, attempt+1); }
    console.error(lang, res.status, (await res.text()).slice(0,200)); return {};
  }
  const j = await res.json();
  try { return JSON.parse(j.choices[0].message.content); } catch {
    if (attempt < 3) return translate(lang, keys, attempt+1);
    return {};
  }
}

for (const lang of Object.keys(NAMES)) {
  const keys: string[] = missing[lang];
  const batches = chunk(keys, 100);
  const out: Record<string,string> = {};
  for (const group of chunk(batches, 6)) {
    const results = await Promise.all(group.map(b => translate(lang, b)));
    for (const r of results) Object.assign(out, r);
    console.log(lang, Object.keys(out).length, '/', keys.length);
  }
  await Bun.write(`/tmp/gen/${lang}.json`, JSON.stringify(out));
}
console.log('DONE');
