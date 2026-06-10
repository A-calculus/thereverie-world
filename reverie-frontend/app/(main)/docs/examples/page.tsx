import { MarkdownDoc } from '@/components/docs/markdown-doc';
import { getMarkdownDoc } from '@/lib/server/docs';

export default async function ExamplesPage() {
  const doc = await getMarkdownDoc('examples');
  return <MarkdownDoc title={doc.title} markdown={doc.markdown} slug="examples" />;
}
