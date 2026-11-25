import { describe, expect, it } from 'vitest';
import { vizaFieldRequirements, type GuestVizaValues } from './guestVizaChecks';
import fixtures from './vizaRequirementsCases.json';

describe('shared VIZA v2 client / SQL fixture', () => {
  it.each(fixtures.cases)('$name', ({patch,missing})=>{
    const guest = {...fixtures.base,...patch} as GuestVizaValues;
    const actual = vizaFieldRequirements(guest,fixtures.reservationId,new Date(fixtures.day+'T00:00:00Z'));
    expect(Object.entries(actual).filter(([,field])=>!field.ok).map(([key])=>key).sort()).toEqual([...missing].sort());
  });
});
