import type { ReactNode } from 'react';
import { BookOpen, IdCard } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';

interface DocumentReviewPreviewProps {
  documentType: 'passport' | 'id_card';
  children: ReactNode;
}

/** Transient, deliberately non-official display of extracted fields only.
 * No document image, raw MRZ, export, persistence or verification claim.
 */
export function DocumentReviewPreview({ documentType, children }: DocumentReviewPreviewProps) {
  const { t } = useTranslation();
  const passport = documentType === 'passport';
  const Icon = passport ? BookOpen : IdCard;
  return (
    <section
      aria-label={t('pms.scan.documentPreview')}
      data-document-preview={documentType}
      className="min-w-0 overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-sm motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-500"
    >
      <div className="flex min-w-0 items-center gap-3 border-b border-border bg-primary/5 px-3 py-3 sm:px-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-background text-primary">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">{t('pms.scan.documentPreview')}</p>
          <p className="break-words text-base font-semibold">{t(passport ? 'pms.guest.docPassport' : 'pms.guest.docIdCard')}</p>
        </div>
      </div>
      <div className="min-w-0 px-3 py-3 sm:px-4">
        {children}
      </div>
      <div className="border-t border-border bg-muted/40 px-3 py-2 text-xs leading-snug text-muted-foreground sm:px-4">
        {t('pms.scan.documentPreviewNote')}
      </div>
    </section>
  );
}
