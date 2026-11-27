import {describe,expect,it} from 'vitest';
import {ALL_CURRICULA,curriculaForOrganization} from '../curricula';
import {trainingGuideAllowed,trainingTargetAllowed} from '../../../../../supabase/functions/_shared/trainingScope';

describe('organization training isolation',()=>{
  const slnt=ALL_CURRICULA.filter(c=>c.slug.startsWith('slnt_'));
  it('excludes every SLNT guide from RD Hotels and unrelated tenant reports and assignments',()=>{
    expect(slnt.length).toBeGreaterThan(0);
    for(const org of ['rdhotels','another-company',null,undefined,'']){
      const catalogue=curriculaForOrganization(org);
      expect(catalogue.some(c=>c.slug.startsWith('slnt_'))).toBe(false);
      if(!org)expect(catalogue).toEqual([]);
    }
    expect(curriculaForOrganization('rdhotels').some(c=>c.slug==='v2_housekeeper_first_day')).toBe(true);
  });
  it('retains SLNT guides in both recognized SLNT tenant identifiers',()=>{
    for(const org of ['slnt','slnt-group']){
      expect(curriculaForOrganization(org).filter(c=>c.slug.startsWith('slnt_')).map(c=>c.slug)).toEqual(slnt.map(c=>c.slug));
    }
  });
  it('rejects forged foreign slugs even when the target is otherwise authorized',()=>{
    expect(trainingGuideAllowed('slnt_future_guide','rdhotels')).toBe(false);
    expect(trainingGuideAllowed('SLNT_team_a_cleaner_v1','rdhotels')).toBe(false);
    expect(trainingGuideAllowed('v2_housekeeper_first_day',undefined)).toBe(false);
  });
  it('keeps HR and ordinary tenant admin targets within the authenticated organization',()=>{
    const rd={organization_slug:'rdhotels'},foreign={organization_slug:'slnt'};
    for(const hr of [true,false]){
      expect(trainingTargetAllowed(rd,rd,hr)).toBe(true);
      expect(trainingTargetAllowed(rd,foreign,hr)).toBe(false);
      expect(trainingTargetAllowed({},rd,hr)).toBe(false);
      expect(trainingTargetAllowed(rd,{},hr)).toBe(false);
    }
    expect(trainingTargetAllowed({...rd,is_super_admin:true},foreign,true)).toBe(false);
    expect(trainingTargetAllowed({...rd,is_super_admin:true},foreign,false)).toBe(true);
  });
});
