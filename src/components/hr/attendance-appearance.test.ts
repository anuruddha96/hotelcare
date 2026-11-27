import {describe,expect,it} from 'vitest';
import {attendanceGrid,metricTones,propertyTone,roleTone,statusTone} from './attendance-appearance';
describe('attendance visual identity',()=>{
 it('gives every role a distinct color in light and dark themes',()=>{
 const keys=['','housekeeping','maintenance','reception','front_office_manager','housekeeping_manager','housekeeping_supervisor','breakfast','manager','top_management','hr','controlling','admin','other'];
 const tones=keys.map(roleTone);
 expect(new Set(tones).size).toBe(keys.length);
 expect(tones.every(t=>t.includes('dark:bg-')&&t.includes('dark:text-'))).toBe(true);
 expect(roleTone('unknown')).toBe(roleTone('other'));
 });
 it('preserves established workforce property colors',()=>{
 const keys=['mika-downtown','memories-budapest','gozsdu-court','ottofiori'];
 const tones=keys.map(propertyTone);
 expect(tones.map(t=>t.header.split(' ')[0])).toEqual(['bg-emerald-800','bg-fuchsia-800','bg-teal-800','bg-violet-800']);
 expect(new Set(tones.map(t=>t.soft)).size).toBe(4);
 expect(propertyTone('__unassigned').header).toContain('bg-slate-');
 });
 it('distinguishes all six attendance states and four summary metrics',()=>{
 expect(new Set(['working','out','break','auto','forgotten','missing'].map(statusTone)).size).toBe(6);
 expect(new Set(metricTones).size).toBe(4);
 expect(attendanceGrid).toContain('lg:grid-cols-');
 });
});
