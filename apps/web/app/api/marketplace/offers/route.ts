import { z } from 'zod';
import type { NextRequest } from 'next/server';
import { api } from '../../../../lib/http-api';
import { publicOffers } from '../../../../lib/marketplace-service';

export async function GET(request: NextRequest) {
  return api(async () => {
    const url = new URL(request.url);
    const offset = z.coerce
      .number()
      .int()
      .min(0)
      .max(10000)
      .parse(url.searchParams.get('offset') ?? 0);
    return publicOffers(offset, (url.searchParams.get('q') ?? '').slice(0, 100));
  });
}
