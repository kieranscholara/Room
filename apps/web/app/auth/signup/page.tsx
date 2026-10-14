import { AuthForm } from '../../../components/auth-form';
export default async function SignupPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const query = await searchParams;
  return <AuthForm mode="signup" returnTo={query.next} />;
}
