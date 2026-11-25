import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DocumentReviewPreview } from './DocumentReviewPreview';

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

describe('DocumentReviewPreview', () => {
  it.each([
    ['passport', 'pms.guest.docPassport'],
    ['id_card', 'pms.guest.docIdCard'],
  ] as const)('shows the %s as a labeled, non-official data preview', (documentType, typeLabel) => {
    render(
      <DocumentReviewPreview documentType={documentType}>
        <dl><dt>Family name</dt><dd>EXAMPLE</dd><dt>Document number</dt><dd>TEST123</dd></dl>
      </DocumentReviewPreview>
    );
    const preview = screen.getByRole('region', { name: 'pms.scan.documentPreview' });
    expect(preview.getAttribute('data-document-preview')).toBe(documentType);
    expect(screen.getByText(typeLabel)).toBeTruthy();
    expect(screen.getByText('EXAMPLE')).toBeTruthy();
    expect(screen.getByText('TEST123')).toBeTruthy();
    expect(screen.getByText('pms.scan.documentPreviewNote')).toBeTruthy();
    expect(preview.querySelector('img, canvas, pre, a[download]')).toBeNull();
    expect(preview.className).toContain('motion-safe:animate-in');
  });
});
