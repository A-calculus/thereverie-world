import { MarkdownDoc } from '@/components/docs/markdown-doc';
import { getMarkdownDoc } from '@/lib/server/docs';

export default async function ApiReferencePage() {
  const doc = await getMarkdownDoc('api-reference');
  return <MarkdownDoc title={doc.title} markdown={doc.markdown} slug="api-reference" />;
}
