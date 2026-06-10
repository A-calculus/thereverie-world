import { MarkdownDoc } from '@/components/docs/markdown-doc';
import { getMarkdownDoc } from '@/lib/server/docs';

export default async function GettingStartedPage() {
  const doc = await getMarkdownDoc('getting-started');
  return <MarkdownDoc title={doc.title} markdown={doc.markdown} slug="getting-started" />;
}
