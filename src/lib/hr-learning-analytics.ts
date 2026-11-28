export type LearningStatus='completed'|'in_progress'|'not_started';
export interface GuideEvidence {employeeId:string;guideKey:string;status:LearningStatus;role:string;property:string}
export function summarizeLearning(records:readonly GuideEvidence[]) {
 const completed=records.filter(r=>r.status==='completed').length;
 const inProgress=records.filter(r=>r.status==='in_progress').length;
 return {total:records.length,completed,inProgress,notStarted:records.length-completed-inProgress,rate:records.length?Math.round(completed*100/records.length):null};
}
export function groupLearning(records:readonly GuideEvidence[],key:'role'|'property'|'employeeId'|'guideKey'){
 const groups=new Map<string,GuideEvidence[]>();
 for(const record of records){const id=record[key];const group=groups.get(id)??[];group.push(record);groups.set(id,group);}
 return [...groups].map(([id,rows])=>({id,...summarizeLearning(rows)})).sort((a,b)=>(a.rate??101)-(b.rate??101)||a.id.localeCompare(b.id));
}
// Spreadsheet cells from names/course titles must not become executable formulas.
export function learningCsvCell(value:string|number|null|undefined):string{
 let s=String(value??'');if(/^[\s\uFEFF]*[=+@-]/.test(s)||/^[\t\r\n]/.test(s))s="'"+s;
 return '"'+s.replace(/"/g,'""')+'"';
}
