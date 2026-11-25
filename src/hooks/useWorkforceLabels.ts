import { useMemo } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import type { CellLabels } from '@/lib/workforce/model';

/** Short absence words for schedule cells, in the reader's language. */
export function useCellLabels(): CellLabels {
  const { t, language } = useTranslation();
  return useMemo(() => ({
    leave: t('wf.c.leave'), halfLeave: t('wf.c.halfLeave'), sick: t('wf.c.sick'), unpaid: t('wf.c.unpaid'),
    absent: t('wf.c.absent'), night: t('wf.c.night'), dayOff: '–',
    // `t` is a new function on every render; the texts only change with the language.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [language]);
}
