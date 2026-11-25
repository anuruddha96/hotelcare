import { describe, expect, it } from 'vitest';
import { lifecycleErrorKey } from './reservations';
describe('Post-departure posting',()=>{it('maps the historical posting guard error to a translation',()=>{expect(lifecycleErrorKey({message:'POST_DEPARTURE_REQUIRES_MANAGER'})).toBe('pms.err.postDepartureRequiresManager');});});
