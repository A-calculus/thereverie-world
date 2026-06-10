import { readFile } from 'node:fs/promises';
import path from 'node:path';

export type DocSlug =
  | 'getting-started'
  | 'agents-guide'
  | 'world-builder'
  | 'triggers-reactivity'
  | 'api-reference'
  | 'examples';

const titles: Record<DocSlug, string> = {
  'getting-started': 'Getting Started',
  'agents-guide': 'Agents Guide',
  'world-builder': 'World Builder',
  'triggers-reactivity': 'Triggers And Reactivity',
  'api-reference': 'API Reference',
  examples: 'Examples',
};

export const docsNav: Array<{ section: string; links: Array<{ slug: DocSlug; title: string }> }> = [
  {
    section: 'Start',
    links: [
      { slug: 'getting-started', title: titles['getting-started'] },
      { slug: 'world-builder', title: titles['world-builder'] },
      { slug: 'examples', title: titles.examples },
    ],
  },
  {
    section: 'Build',
    links: [
      { slug: 'agents-guide', title: titles['agents-guide'] },
      { slug: 'triggers-reactivity', title: titles['triggers-reactivity'] },
      { slug: 'api-reference', title: titles['api-reference'] },
    ],
  },
];

export async function getMarkdownDoc(slug: DocSlug) {
  const filePath = path.join(process.cwd(), 'content', 'docs', `${slug}.md`);
  const markdown = await readFile(filePath, 'utf8');
  return {
    title: titles[slug],
    markdown,
  };
}
