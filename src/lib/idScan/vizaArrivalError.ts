// Only structured guest names and missing field keys come from the scoped RPC.
const LABELS: Record<string,string> = {
 last_name:'pms.guest.familyName',first_name:'pms.guest.givenName',nationality:'pms.guest.nationality',
 date_of_birth:'pms.guest.birthDate',birth_place:'pms.guest.birthPlace',gender:'pms.guest.gender',
 birth_last_name:'pms.guest.birthFamilyName',birth_first_name:'pms.guest.birthGivenName',
 mother_family_name:'pms.guest.motherFamily',mother_given_name:'pms.guest.motherGiven',
 visa_number:'pms.guest.visaNumber',entry_date:'pms.guest.entryDate',entry_place:'pms.guest.entryPlace',
 entry_details_reason:'pms.guest.requirement.reason',occupant_count:'pms.guest.occupantCount',manual_reason:'pms.guest.manualReason',parent_statement:'pms.guest.parentStatement',
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

export function firstVizaArrivalFailure(message:string): {guestId:string;field:string}|null {
  const prefix='VIZA_GUEST_DATA_INCOMPLETE: ';
  if(!message.includes(prefix)) return null;
  try {
    const rows=JSON.parse(message.slice(message.indexOf(prefix)+prefix.length)) as {guest_id?:string;fields?:string[]}[];
    const first=rows.find(r=>r.guest_id && r.fields?.length);
    return first?.guest_id && first.fields?.[0] ? {guestId:first.guest_id,field:first.fields[0]} : null;
  } catch { return null; }
}
