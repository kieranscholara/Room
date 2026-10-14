import { ConsumerEditor } from '../../../components/consumer-editor';
export default async function PersonalDesignPage({ params }: { params: Promise<{ projectId: string }> }) {
  return <ConsumerEditor projectId={(await params).projectId} />;
}
