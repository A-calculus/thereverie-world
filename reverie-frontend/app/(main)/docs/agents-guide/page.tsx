import { MarkdownDoc } from '@/components/docs/markdown-doc';
import { getMarkdownDoc } from '@/lib/server/docs';

export default async function AgentsGuidePage() {
  const doc = await getMarkdownDoc('agents-guide');
  return <MarkdownDoc title={doc.title} markdown={doc.markdown} slug="agents-guide" />;
}
