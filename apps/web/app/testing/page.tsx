import { notFound } from 'next/navigation';
import { testingEnabled } from '../../lib/local-testing';
import { TestingCustomer } from '../../components/testing-customer';
export const dynamic = 'force-dynamic';
export default function TestingPage() {
  if (!testingEnabled()) notFound();
  return <TestingCustomer />;
}
