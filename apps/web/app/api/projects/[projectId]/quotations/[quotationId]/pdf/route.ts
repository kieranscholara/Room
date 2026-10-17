import { NextRequest } from 'next/server';
import { api } from '../../../../../../../lib/http-api';
import { getQuotation } from '../../../../../../../lib/quotation-service';
import { renderQuotationPdf } from '../../../../../../../lib/quotation-pdf';
import { adminClient, databaseError } from '../../../../../../../lib/supabase-server';
import { createHash } from 'node:crypto';
import { ServiceError } from '../../../../../../../lib/editor-service';
type Context = { params: Promise<{ projectId: string; quotationId: string }> };
export async function GET(_request: NextRequest, { params }: Context) {
  let response: Response | undefined;
  const error = await api(async () => {
    const { projectId, quotationId } = await params;
    const quotation = await getQuotation(projectId, quotationId);
    let photoBytes: Buffer | undefined;
    if (quotation.snapshot.photo) {
      const row = await adminClient()
        .from('room_references')
        .select('path')
        .eq('project_id', projectId)
        .eq('organisation_id', quotation.organisationId)
        .eq('id', quotation.snapshot.photo.renderedReferenceId)
        .single();
      databaseError(row.error);
      if (!row.data) throw new ServiceError(404, 'Confirmed quotation photograph unavailable.');
      const image = await adminClient().storage.from('room-references').download(row.data.path);
      if (image.error || !image.data)
        throw new ServiceError(503, 'The confirmed quotation photograph is unavailable.');
      photoBytes = Buffer.from(await image.data.arrayBuffer());
      if (createHash('sha256').update(photoBytes).digest('hex') !== quotation.snapshot.photo.imageSha256)
        throw new ServiceError(500, 'Quotation photograph integrity check failed.');
    }
    const bytes = await renderQuotationPdf(quotation, photoBytes);
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
