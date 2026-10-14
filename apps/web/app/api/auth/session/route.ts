import { api } from '../../../../lib/http-api';
import { authenticated } from '../../../../lib/supabase-server';
export const dynamic = 'force-dynamic';
export async function GET() {
  return api(async () => {
    const { user } = await authenticated();
    return { user: { id: user.id, email: user.email } };
  });
}
