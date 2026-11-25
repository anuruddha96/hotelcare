/** Curated, local-only issue-title catalog. No ticket/guest data or AI calls are used. */
export type MaintenanceTitle = { id: string; category: string; en: string; hu: string; keywords?: string };
const rows: Array<[string, string, string, string?]> = [
  ['Curtain rail loose','Függönykarnis meglazult','curtain függöny karnis'],
  ['Curtain not closing','A függöny nem húzható be','curtain függöny stuck'],
  ['Curtain damaged','Sérült függöny','curtain függöny torn'],
  ['Blackout curtain missing','Hiányzik a sötétítőfüggöny','curtain függöny blackout'],
  ['Window will not open','Az ablak nem nyitható','window ablak'],
  ['Window will not close','Az ablak nem zárható','window ablak'],
  ['Window glass cracked','Repedt ablaküveg','window ablak glass üveg'],
  ['Window handle broken','Törött ablakkilincs','window ablak handle kilincs'],
  ['Door lock not working','Az ajtózár nem működik','door ajtó lock zár keycard'],
  ['Door handle loose','Laza ajtókilincs','door ajtó handle kilincs'],
  ['Door does not close','Az ajtó nem csukódik','door ajtó'],
  ['Key card reader not working','A kártyaolvasó nem működik','key card kulcskártya reader'],
  ['Safe not opening','A széf nem nyílik','safe széf'],
  ['Wardrobe door damaged','Sérült szekrényajtó','wardrobe szekrény'],
  ['Bed frame damaged','Sérült ágykeret','bed ágy'],
  ['Mattress damaged','Sérült matrac','bed ágy mattress matrac'],
  ['Chair broken','Törött szék','chair szék'],
  ['Table unstable','Instabil asztal','table asztal'],
  ['Desk damaged','Sérült íróasztal','desk asztal'],
  ['Mirror damaged','Sérült tükör','mirror tükör'],
  ['Wall damaged','Sérült fal','wall fal'],
  ['Ceiling leak','Beázik a mennyezet','ceiling mennyezet leak beázás'],
  ['Paint peeling','Hámlik a festék','paint festék'],
  ['Floor tile damaged','Sérült padlólap','floor padló tile csempe'],
  ['Carpet damaged','Sérült szőnyeg','carpet szőnyeg'],
  ['Air conditioning not cooling','A légkondicionáló nem hűt','ac aircon air conditioning klima klíma'],
  ['Air conditioning not heating','A légkondicionáló nem fűt','ac aircon klima klíma heating'],
  ['Air conditioning leaking water','Csöpög a légkondicionáló','ac aircon klima klíma leak'],
  ['Air conditioning making noise','Zajos a légkondicionáló','ac aircon klima klíma noise'],
  ['Air conditioning remote not working','A klímatávirányító nem működik','ac aircon klima klíma remote'],
  ['Heating not working','Nem működik a fűtés','heater radiator radiátor fűtés'],
  ['Radiator leaking','Szivárog a radiátor','radiator radiátor leak'],
  ['Ventilation not working','Nem működik a szellőzés','ventilation szellőzés fan ventilátor'],
  ['Light not working','Nem működik a lámpa','light világítás lámpa bulb izzó'],
  ['Light flickering','Villog a lámpa','light világítás lámpa flicker'],
  ['Light switch broken','Törött villanykapcsoló','light switch kapcsoló'],
  ['Power outlet not working','Nem működik a konnektor','socket outlet konnektor'],
  ['Power outage in room','Áramszünet a szobában','electricity áram power'],
  ['Bathroom light not working','Nem működik a fürdőszobai lámpa','bathroom fürdőszoba light lámpa'],
  ['Water tap leaking','Csöpög a csap','tap faucet csap leak'],
  ['No hot water','Nincs meleg víz','hot water meleg víz'],
  ['Low water pressure','Alacsony víznyomás','water víz pressure nyomás'],
  ['Shower head broken','Törött zuhanyfej','shower zuhany'],
  ['Shower drain blocked','Eldugult a zuhanylefolyó','shower zuhany drain lefolyó'],
  ['Shower door damaged','Sérült zuhanyajtó','shower zuhany door ajtó'],
  ['Toilet blocked','Eldugult a WC','toilet wc dugulás'],
  ['Toilet not flushing','Nem öblít a WC','toilet wc flush öblítés'],
  ['Toilet leaking','Szivárog a WC','toilet wc leak'],
  ['Sink blocked','Eldugult a mosdó','sink mosdó drain lefolyó'],
  ['Sink leaking','Szivárog a mosdó','sink mosdó leak'],
  ['Bathroom extractor not working','Nem működik a fürdőszobai elszívó','bathroom fürdőszoba fan elszívó'],
  ['Water leak detected','Vízszivárgás észlelve','water víz leak szivárgás'],
  ['TV not turning on','Nem kapcsol be a TV','television tv tévé'],
  ['TV remote not working','Nem működik a TV-távirányító','television tv tévé remote'],
  ['Wi-Fi not working','Nem működik a Wi-Fi','wifi wi-fi internet hálózat'],
  ['Telephone not working','Nem működik a telefon','phone telefon'],
  ['Mini fridge not cooling','Nem hűt a minibárhűtő','fridge refrigerator hűtő minibar'],
  ['Kettle not working','Nem működik a vízforraló','kettle vízforraló'],
  ['Coffee machine not working','Nem működik a kávéfőző','coffee kávé machine gép'],
  ['Hair dryer not working','Nem működik a hajszárító','hairdryer hajszárító'],
  ['Smoke detector beeping','Sípol a füstérzékelő','smoke detector füstérzékelő alarm riasztó'],
  ['Fire alarm fault','Tűzjelző meghibásodás','fire tűz alarm riasztó'],
  ['Emergency light not working','Nem működik a vészvilágítás','emergency vész light lámpa'],
  ['Lift not working','Nem működik a lift','elevator lift felvonó'],
  ['Lift door malfunction','A liftajtó hibás','elevator lift felvonó door ajtó'],
  ['Corridor light not working','Nem működik a folyosói lámpa','corridor folyosó light lámpa'],
  ['Stairwell light not working','Nem működik a lépcsőházi lámpa','stairs lépcsőház light lámpa'],
  ['Reception equipment fault','Recepciós berendezés meghibásodása','reception recepció equipment'],
  ['Entrance door not working','Nem működik a bejárati ajtó','entrance bejárat door ajtó'],
  ['Intercom not working','Nem működik a kaputelefon','intercom kaputelefon'],
  ['Outdoor lighting fault','Kültéri világítási hiba','outdoor kültéri light lámpa'],
  ['Balcony door damaged','Sérült erkélyajtó','balcony erkély door ajtó'],
  ['Balcony railing loose','Laza erkélykorlát','balcony erkély railing korlát'],
  ['Pest activity reported','Kártevő jelenlétét jelentették','pest kártevő insect rovar'],
  ['Unpleasant smell in room','Kellemetlen szag a szobában','smell szag odor'],
  ['Mould suspected','Penész gyanúja','mould mold penész'],
  ['Other maintenance issue','Egyéb karbantartási hiba','other egyéb maintenance karbantartás'],
];
const category = (index: number): string => index < 4 ? 'curtains' : index < 9 ? 'windows' : index < 13 ? 'doors' : index < 25 ? 'fixtures' : index < 33 ? 'hvac' : index < 39 ? 'electrical' : index < 53 ? 'plumbing' : index < 60 ? 'appliances' : index < 63 ? 'safety' : index < 65 ? 'elevators' : 'common-areas';
export const maintenanceTitleCatalog: MaintenanceTitle[] = rows.map(([en, hu, keywords], index) => ({ id: `hotel-issue-${index + 1}`, category: category(index), en, hu, keywords }));
export const normalizeMaintenanceQuery = (value: string): string => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
export function suggestMaintenanceTitles(query: string, language: string, limit = 6): MaintenanceTitle[] {
  const needle = normalizeMaintenanceQuery(query);
  if (needle.length < 2) return [];
  const tokens = needle.split(' ').filter(Boolean);
  return maintenanceTitleCatalog.map((item, index) => {
    const en = normalizeMaintenanceQuery(item.en);
    const hu = normalizeMaintenanceQuery(item.hu);
    const keys = normalizeMaintenanceQuery(item.keywords || '');
    const fields = [en, hu, keys];
    const score = fields.reduce((best, text) => {
      if (text === needle) return Math.max(best, 100);
      if (text.startsWith(needle)) return Math.max(best, 80);
      if (text.split(' ').some(word => word.startsWith(needle))) return Math.max(best, 65);
      if (text.includes(needle)) return Math.max(best, 45);
      if (tokens.every(token => text.includes(token))) return Math.max(best, 25);
      return best;
    }, 0);
    return { item, score: score + (language === 'hu' && hu.startsWith(needle) ? 5 : 0), index };
  }).filter(result => result.score > 0).sort((a, b) => b.score - a.score || a.index - b.index).slice(0, Math.max(0, limit)).map(result => result.item);
}
export function localizedMaintenanceTitle(item: MaintenanceTitle, language: string): string {
  return language === 'hu' ? item.hu || item.en : item.en;
}
