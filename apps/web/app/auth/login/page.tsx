import { AuthForm } from '../../../components/auth-form';
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; confirmation?: string }>;
}) {
  const query = await searchParams;
  return (
    <AuthForm mode="login" returnTo={query.next} confirmationInvalid={query.confirmation === 'invalid'} />
  );
}
