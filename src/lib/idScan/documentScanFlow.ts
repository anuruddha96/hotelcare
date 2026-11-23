import type { MrzReadResult } from './mrz';

/** No dropdown: a machine-readable passport is a single bio-page scan.
 * ID cards require the printed front captured before accepting the back MRZ.
 * Never combine an ID front with a different passport's bio page.
 */
export type MrzScanAction =
  | 'passport_complete'
  | 'id_complete'
  | 'front_first_required'
  | 'different_document';

export function nextMrzScanAction(
  mrz: Pick<MrzReadResult, 'fields'>,
  idFrontCaptured: boolean,
): MrzScanAction {
  if (mrz.fields.documentType === 'passport') {
    return idFrontCaptured ? 'different_document' : 'passport_complete';
  }
  return idFrontCaptured ? 'id_complete' : 'front_first_required';
}
