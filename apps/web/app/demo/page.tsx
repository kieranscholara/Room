import { Editor } from '../../components/editor';
import { notFound } from 'next/navigation';
import { demoEnabled } from '../../lib/demo-policy';
export const dynamic = 'force-dynamic';
export default function DemoPage() {
  if (!demoEnabled()) notFound();
  return <Editor />;
}
