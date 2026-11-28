import {describe,it,expect} from 'vitest';
import {summarizeLearning,groupLearning,learningCsvCell,type GuideEvidence} from './hr-learning-analytics';
const records:GuideEvidence[]=[{employeeId:'a',guideKey:'x',role:'housekeeping',property:'mika',status:'completed'},{employeeId:'a',guideKey:'y',role:'housekeeping',property:'mika',status:'in_progress'},{employeeId:'b',guideKey:'x',role:'reception',property:'otto',status:'not_started'}];
describe('HR learning coverage',()=>{
 it('uses guide/account pairs, not employee counts, for completion',()=>expect(summarizeLearning(records)).toEqual({total:3,completed:1,inProgress:1,notStarted:1,rate:33}));
 it('shows N/A for empty eligible cohort',()=>expect(summarizeLearning([]).rate).toBeNull());
 it('aggregates only provided scoped rows and prioritizes lower coverage',()=>{
 expect(groupLearning(records,'property').map(x=>[x.id,x.rate])).toEqual([['otto',0],['mika',50]]);
 expect(groupLearning(records.slice(0,2),'employeeId')).toEqual([{id:'a',total:2,completed:1,inProgress:1,notStarted:0,rate:50}]);
 });
 it('quotes CSV and guards spreadsheet formulas',()=>{
 expect(learningCsvCell('=1+1')).toBe('"\'=1+1"');
 expect(learningCsvCell(' A "B"')).toBe('" A ""B"""');
 expect(learningCsvCell('  @SUM(A1)')).toBe('"\'  @SUM(A1)"');
 });
});
