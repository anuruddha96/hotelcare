// Manager — Purchase Invoices module
import type { TrainingCurriculum } from '../types';

export const managerInvoicesCurriculum: TrainingCurriculum = {
  slug: 'v2_manager_purchase_invoices',
  name: {
    en: 'Purchase Invoices',
    hu: 'Beszerzési Számlák',
    es: 'Facturas de Compra',
    vi: 'Hóa đơn Mua hàng',
    mn: 'Худалдан авалтын Нэхэмжлэх',
  },
  description: {
    en: 'Upload, AI extraction, line-item review and approval workflow.',
    hu: 'Feltöltés, AI kinyerés, tételek ellenőrzése és jóváhagyás.',
    es: 'Carga, extracción IA, revisión de líneas y aprobación.',
    vi: 'Tải lên, AI trích xuất, kiểm tra dòng và phê duyệt.',
    mn: 'Оруулах, AI задлах, мөр шалгах ба зөвшөөрөл.',
  },
  roles: ['top_management', 'top_management_manager', 'admin'],
  category: 'feature_promo',
  priority: 30,
  moduleKey: 'invoices',
  estMinutes: 2,
  steps: [
    {
      key: 'open_invoices',
      title: {
        en: 'Open Purchase Invoices',
        hu: 'Beszerzési Számlák megnyitása',
        es: 'Abrir Facturas de Compra',
        vi: 'Mở Hóa đơn Mua hàng',
        mn: 'Худалдан авалтын Нэхэмжлэх нээх',
      },
      body: {
        en: 'Top tab "Invoices" opens the upload + queue + analytics view for the selected hotel.',
        hu: 'Az "Invoices" fül megnyitja a feltöltés/sor/analitika nézetet.',
        es: 'La pestaña Invoices abre la vista de carga, cola y analítica.',
        vi: 'Tab Invoices mở giao diện tải, hàng đợi và phân tích.',
        mn: '"Invoices" таб оруулах, дараалал, аналитик нээнэ.',
      },
      route: '/:org/purchase-invoices',
    },
    {
      key: 'upload',
      title: {
        en: 'Upload a PDF or photo',
        hu: 'PDF vagy fotó feltöltése',
        es: 'Subir PDF o foto',
        vi: 'Tải PDF hoặc ảnh',
        mn: 'PDF эсвэл зураг оруулах',
      },
      body: {
        en: 'Drop the supplier invoice here — AI extracts vendor, dates, totals, VAT and line items in seconds. Multi-page PDFs work too.',
        hu: 'Húzd ide a számlát — az AI kinyeri a szállítót, dátumokat, összegeket és tételeket.',
        es: 'Suelta la factura — la IA extrae proveedor, fechas, totales y líneas.',
        vi: 'Thả hóa đơn vào — AI trích xuất nhà cung cấp, ngày, tổng, dòng.',
        mn: 'Нэхэмжлэхээ оруулахад AI нийлүүлэгч, огноо, дүн, мөрийг гаргана.',
      },
      route: '/:org/purchase-invoices',
      selector: '[data-training="invoice-upload"]',
    },
    {
      key: 'review',
      title: {
        en: 'Review extracted line items',
        hu: 'Kinyert tételek ellenőrzése',
        es: 'Revisar líneas extraídas',
        vi: 'Kiểm tra dòng được trích',
        mn: 'Задалсан мөрүүдийг шалгах',
      },
      body: {
        en: 'Open any queued invoice to see side-by-side: original document on the left, editable extracted fields on the right. Fix anything wrong before approving.',
        hu: 'Nyiss meg egy számlát — bal oldalon az eredeti, jobb oldalon a szerkeszthető mezők.',
        es: 'Abre la factura — original a la izquierda, campos editables a la derecha.',
        vi: 'Mở hóa đơn — gốc bên trái, trường có thể sửa bên phải.',
        mn: 'Нэхэмжлэх нээхэд зүүн талд эх, баруун талд засварлах талбарууд.',
      },
    },
    {
      key: 'approve',
      title: {
        en: 'Approve & lock',
        hu: 'Jóváhagyás és zárolás',
        es: 'Aprobar y bloquear',
        vi: 'Phê duyệt & khóa',
        mn: 'Зөвшөөрч түгжих',
      },
      body: {
        en: 'Approval locks the invoice (no further edits) and feeds the Analytics tab — vendor totals, monthly spend and top categories update instantly.',
        hu: 'A jóváhagyás zárolja a számlát és frissíti az Analitikát.',
        es: 'La aprobación bloquea la factura y actualiza la analítica.',
        vi: 'Phê duyệt khóa hóa đơn và cập nhật phân tích.',
        mn: 'Зөвшөөрөл нь нэхэмжлэхийг түгжиж аналитикийг шинэчилнэ.',
      },
    },
  ],
};
