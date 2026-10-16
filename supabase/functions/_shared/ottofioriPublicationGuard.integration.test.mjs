import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import * as guard from './ottofioriPublicationGuard.ts';

function fixture() {
  const stay_date = '2026-11-06';
  const drafts = [2,2,2,3,4].flatMap((cap,kind)=>Array.from({length:cap},(_,i)=>({
    id:`d-${kind}-${i}`, stay_date, obk_id:`kind-${kind}`, room_type_name:`Kind ${kind}`,
    occupancy:i+1, old_price:200+kind*20+i*10, new_price:194+kind*20+i*10,
    currency:'EUR', decision_id:'decision', intent_source:'automation_markdown',
    decision_reason:'fill_markdown', created_at:new Date().toISOString(),
  })));
  return {drafts, mirror:drafts.map(d=>({...d,rate_plan_id:'plan',price:d.old_price})),
    decisions:[{id:'decision',hotel_id:'ottofiori',stay_date,status:'queued',direction:'decrease',
      movement:-6,cells_simulated:13}], manual:[], readError:false};
}
async function invoke(f) {
  const writes=[]; let externalWrites=0; let handler;
  class Query {
    constructor(table){this.table=table;this.columns='';this.operation='select';}
    select(columns){this.columns=columns;return this;}
    update(value){this.operation='update';this.value=value;return this;}
    insert(value){this.operation='insert';this.value=value;return this;}
    eq(){return this;} neq(){return this;} in(){return this;} is(){return this;}
    not(){return this;} gte(){return this;} lte(){return this;} order(){return this;}
    limit(){return this;} maybeSingle(){return this;}
    then(resolve,reject){return Promise.resolve(this.result()).then(resolve,reject);}
    result(){
      if(this.operation!=='select'){writes.push({table:this.table,value:this.value});return {data:[],error:null};}
      const single=(data)=>({data,error:null});
      switch(this.table){
        case 'pms_configurations':return single({is_active:true,pms_hotel_id:'786631'});
        case 'pms_accounts':return single([{is_active:true,pms_hotel_id:'786631'}]);
        case 'room_types':return single({organization_slug:'rdhotels'});
        case 'previo_rate_plan_mapping':return single([0,1,2,3,4].map(i=>({previo_room_type_id:`kind-${i}`,previo_rate_plan_id:'plan'})));
        case 'hotel_revenue_settings':return single({rate_write_method:'eqc:AvailRateUpdate',base_currency:'EUR'});
        case 'revenue_rate_drafts':
          return single(this.columns==='stay_date, decision_reason, status'?f.manual:f.drafts);
        case 'revenue_rate_push_runs':
          return single(this.columns.includes('date_manifest')?{automation_run_id:'auto',
            date_manifest:{'2026-11-06':{decision_id:'decision',expected_cells:13}}}:{automation_run_id:null});
        case 'revenue_automation_runs':return single(null);
        case 'revenue_date_decisions':return f.readError?{data:null,error:{message:'read failed'}}:single(f.decisions);
        case 'revenue_room_type_rates':return single(f.mirror);
        default:throw new Error(`Unexpected read: ${this.table} ${this.columns}`);
      }
    }
  }
  const admin={from:table=>new Query(table),rpc:async()=>({data:true,error:null})};
  const context=vm.createContext({
    Request,Response,crypto,console:{log(){},error(){}},URL,Date,Map,Set,Promise,setTimeout,
    createClient:()=>admin, loadPrevioCredentials:()=>({}),hasPrevioCredentials:()=>true,
    writePrevioRate:async()=>{externalWrites++;throw new Error('A blocked test must never reach Previo');},
    readPrevioRateLevelsRange:async()=>new Map(),syncPrevioRatePlanMappings:async()=>({notes:[]}),
    pricesMatch:(a,b)=>a===b, partitionByExactRateMappings:async(_a,_h,d)=>({mapped:d,unmapped:[]}),
    filterRoomHierarchy:async(_a,_h,d)=>({kept:d,dropped:[]}),liftHigherRooms:async()=>[],repairLadder:()=>new Map(),
    ...guard, Deno:{env:{get:k=>k==='SUPABASE_SERVICE_ROLE_KEY'?'test-only-key':'https://example.invalid'},
      serve:callback=>{handler=callback;}},
  });
  const source=readFileSync(new URL('../revenue-push-drafts/index.ts',import.meta.url),'utf8')
    .replace(/^import .*;\r?\n/gm,'');
  vm.runInContext(stripTypeScriptTypes(source),context);
  const response=await handler(new Request('https://example.invalid/push',{method:'POST',
    headers:{'content-type':'application/json','x-engine-key':'test-only-key'},
    body:JSON.stringify({hotelId:'ottofiori',pushRunId:'run',continuationBudget:0})}));
  return {status:response.status,body:await response.json(),externalWrites,writes};
}
test('actual publisher sends no Previo call for the 12-child held-decision regression',async()=>{
  const f=fixture();f.drafts.shift();f.decisions[0].status='held';
  const result=await invoke(f);
  assert.equal(result.body.code,'ottofiori_publication_blocked');
  assert.equal(result.externalWrites,0);
  assert.ok(result.writes.some(w=>w.table==='revenue_rate_drafts'&&w.value.confirmation_status==='blocked'));
});
test('actual publisher sends no partial column even when decision status remains queued',async()=>{
  const f=fixture();f.drafts.pop();const result=await invoke(f);
  assert.equal(result.body.code,'ottofiori_publication_blocked');assert.equal(result.externalWrites,0);
});
test('actual publisher fails closed when durable decision read fails',async()=>{
  const f=fixture();f.readError=true;const result=await invoke(f);
  assert.equal(result.status,500);assert.equal(result.externalWrites,0);
});
test('actual publisher respects a newly protected manager date',async()=>{
  const f=fixture();f.manual=[{stay_date:'2026-11-06',decision_reason:null,status:'pushed'}];
  const result=await invoke(f);
  assert.equal(result.body.code,'ottofiori_publication_blocked');assert.equal(result.externalWrites,0);
});
