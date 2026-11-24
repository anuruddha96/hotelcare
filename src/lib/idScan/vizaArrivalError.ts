// Only structured guest names and missing field keys come from the scoped RPC.
const LABELS: Record<string,string> = {
 last_name:'pms.guest.familyName',first_name:'pms.guest.givenName',nationality:'pms.guest.nationality',
 date_of_birth:'pms.guest.birthDate',birth_place:'pms.guest.birthPlace',gender:'pms.guest.gender',
 id_document_type:'pms.guest.docType',id_document_number:'pms.guest.docNumber',
};
export function formatVizaArrivalError(message: string, t: (key:string)=>string): string | null {
 const prefix='VIZA_GUEST_DATA_INCOMPLETE: ';
 if (!message.includes(prefix)) return null;
 const title=t('pms.guest.vizaArrivalBlocked');
 try {
  const rows=JSON.parse(message.slice(message.indexOf(prefix)+prefix.length)) as Array<{guest:string;fields:string[]}>;
  if (!Array.isArray(rows)) return title;
  return title + ' — ' + rows.map(row => row.guest + ': ' + row.fields.map(field => t(LABELS[field] || field)).join(', ')).join('; ');
 } catch { return title; }
}
