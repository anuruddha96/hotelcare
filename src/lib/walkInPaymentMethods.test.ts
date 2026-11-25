import { describe, expect, it } from 'vitest';
import { PMS_PAYMENT_METHODS, WALK_IN_PAYMENT_METHODS } from './pmsFinance';
describe('Walk-in sales',()=>{it('excludes deferred settlement but keeps supported immediate methods and ordinary reservation methods',()=>{expect(WALK_IN_PAYMENT_METHODS).toEqual(PMS_PAYMENT_METHODS.filter(m=>m!=='on_account'));expect(WALK_IN_PAYMENT_METHODS).not.toContain('on_account');expect(WALK_IN_PAYMENT_METHODS).toContain('card_terminal');expect(PMS_PAYMENT_METHODS).toContain('on_account');});});
