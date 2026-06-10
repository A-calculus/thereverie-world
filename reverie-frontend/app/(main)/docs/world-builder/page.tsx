import { MarkdownDoc } from '@/components/docs/markdown-doc';
import { getMarkdownDoc } from '@/lib/server/docs';

export default async function WorldBuilderDocsPage() {
  const doc = await getMarkdownDoc('world-builder');
  return <MarkdownDoc title={doc.title} markdown={doc.markdown} slug="world-builder" />;
}
