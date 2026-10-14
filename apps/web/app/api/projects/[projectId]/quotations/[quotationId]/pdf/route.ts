import { NextRequest } from 'next/server';
import { api } from '../../../../../../../lib/http-api';
import { getQuotation } from '../../../../../../../lib/quotation-service';
import { renderQuotationPdf } from '../../../../../../../lib/quotation-pdf';
type Context = { params: Promise<{ projectId: string; quotationId: string }> };
export async function GET(_request: NextRequest, { params }: Context) {
  let response: Response | undefined;
  const error = await api(async () => {
    const { projectId, quotationId } = await params;
    const quotation = await getQuotation(projectId, quotationId);
    const bytes = await renderQuotationPdf(quotation);
    response = new Response(Buffer.from(bytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${quotation.number}.pdf"`,
        'Content-Length': String(bytes.byteLength),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
    return null;
  });
  return response || error;
}
