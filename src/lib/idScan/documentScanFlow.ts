import type { MrzReadResult } from './mrz';

export type MrzScanAction = 'passport_complete' | 'id_complete' | 'front_first_required' | 'different_document';

/** A provisional front capture is not proof of an ID. A valid passport can
 * recover from that provisional state, but not from positive ID evidence. */
export function nextMrzScanAction(mrz: Pick<MrzReadResult, 'fields'>,
  idFrontCaptured: boolean, positiveIdEvidence = idFrontCaptured): MrzScanAction {
  if (mrz.fields.documentType === 'passport') {
    return positiveIdEvidence ? 'different_document' : 'passport_complete';
  }
  return idFrontCaptured ? 'id_complete' : 'front_first_required';
}

export type FirstSideAction = 'passport_complete' | 'front_first_required' | 'provisional_front' | 'retry';
export function firstSideAction(mrz: Pick<MrzReadResult, 'valid' | 'unknownCountry' | 'format' | 'fields'> | null,
  sharpAndExposed: boolean): FirstSideAction {
  if (mrz?.valid && !mrz.unknownCountry) {
    if (mrz.format === 'TD3' && mrz.fields.documentType === 'passport') return 'passport_complete';
    if (mrz.format !== 'TD3' && mrz.fields.documentType === 'id_card') return 'front_first_required';
  }
  return sharpAndExposed ? 'provisional_front' : 'retry';
}
