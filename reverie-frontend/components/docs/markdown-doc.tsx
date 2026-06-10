import Link from 'next/link';
import { BookOpen, ChevronRight } from 'lucide-react';
import { docsNav } from '@/lib/server/docs';
import { docsUrl } from '@/lib/shared/routes';

interface MarkdownDocProps {
  title: string;
  markdown: string;
  slug?: string;
}

type Block =
  | { type: 'heading'; level: number; text: string; id: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; items: string[] }
  | { type: 'code'; language: string; text: string };

function parseMarkdown(markdown: string): Block[] {
  const blocks: Block[] = [];
  const lines = markdown.split(/\r?\n/);
  let paragraph: string[] = [];
  let list: string[] = [];
  let code: string[] | null = null;
  let codeLanguage = '';

  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push({ type: 'paragraph', text: paragraph.join(' ') });
      paragraph = [];
    }
  };

  const flushList = () => {
    if (list.length) {
      blocks.push({ type: 'list', items: list });
      list = [];
    }
  };

  for (const line of lines) {
    if (line.startsWith('```')) {
      if (code) {
        blocks.push({ type: 'code', language: codeLanguage, text: code.join('\n') });
        code = null;
        codeLanguage = '';
      } else {
        flushParagraph();
        flushList();
        code = [];
        codeLanguage = line.slice(3).trim();
      }
      continue;
    }

    if (code) {
      code.push(line);
      continue;
    }

    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(trimmed);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2], id: slugify(heading[2]) });
      continue;
    }

    if (trimmed.startsWith('- ')) {
      flushParagraph();
      list.push(trimmed.slice(2));
      continue;
    }

    flushList();
    paragraph.push(trimmed);
  }

  flushParagraph();
  flushList();
  return blocks;
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function InlineText({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`)/g);
  return (
    <>
      {parts.map((part, index) => {
        if (part.startsWith('`') && part.endsWith('`')) {
          return (
            <code key={`${part}-${index}`} className="rounded bg-void px-1.5 py-0.5 font-mono text-xs text-teal">
              {part.slice(1, -1)}
            </code>
          );
        }
        return <span key={`${part}-${index}`}>{part}</span>;
      })}
    </>
  );
}

export function MarkdownDoc({ title, markdown, slug }: MarkdownDocProps) {
  const blocks = parseMarkdown(markdown);
  const toc = blocks.filter((block) => block.type === 'heading' && block.level <= 2) as Array<Extract<Block, { type: 'heading' }>>;

  return (
    <div className="mx-auto grid w-full max-w-7xl grid-cols-1 gap-8 lg:grid-cols-[240px_minmax(0,1fr)_220px]">
      <aside className="hidden lg:block">
        <div className="sticky top-24 space-y-6">
          <Link href={docsUrl()} className="flex items-center gap-2 text-sm font-semibold text-text-primary">
            <BookOpen className="h-4 w-4 text-teal" />
            REVERIE Docs
          </Link>
          {docsNav.map((section) => (
            <div key={section.section}>
              <p className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-wider text-text-muted">{section.section}</p>
              <nav className="space-y-1">
                {section.links.map((link) => (
                  <Link
                    key={link.slug}
                    href={docsUrl(`/${link.slug}`)}
                    className={`block rounded-md px-2 py-1.5 text-sm transition-colors ${
                      slug === link.slug ? 'bg-dream/15 text-teal' : 'text-text-muted hover:bg-dream/10 hover:text-text-primary'
                    }`}
                  >
                    {link.title}
                  </Link>
                ))}
              </nav>
            </div>
          ))}
        </div>
      </aside>

      <article className="min-w-0">
        <div className="mb-8 border-b border-dream/10 pb-6">
          <div className="mb-4 flex items-center gap-2 text-sm text-text-muted">
            <Link href={docsUrl()} className="hover:text-teal">Docs</Link>
            <ChevronRight className="h-3 w-3" />
            <span>{title}</span>
          </div>
          <h1 className="text-4xl font-display font-bold text-text-primary">{title}</h1>
        </div>

        <div className="space-y-5 leading-relaxed text-text-muted">
          {blocks.map((block, index) => {
            if (block.type === 'heading') {
              const className = block.level === 1
                ? 'scroll-mt-24 text-2xl font-display font-semibold text-text-primary'
                : 'scroll-mt-24 text-xl font-display font-semibold text-text-primary';
              return <h2 id={block.id} key={`${block.text}-${index}`} className={className}>{block.text}</h2>;
            }

            if (block.type === 'list') {
              return (
                <ul key={`list-${index}`} className="list-disc space-y-2 pl-6">
                  {block.items.map((item) => (
                    <li key={item}><InlineText text={item} /></li>
                  ))}
                </ul>
              );
            }

            if (block.type === 'code') {
              return (
                <pre key={`code-${index}`} className="overflow-x-auto rounded-lg border border-dream/20 bg-void p-4 text-sm text-text-primary">
                  <code className="font-mono">{block.text}</code>
                </pre>
              );
            }

            return <p key={`${block.text}-${index}`}><InlineText text={block.text} /></p>;
          })}
        </div>
      </article>

      <aside className="hidden xl:block">
        <div className="sticky top-24">
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-text-muted">On this page</p>
          <nav className="space-y-2 border-l border-dream/15 pl-4">
            {toc.length ? toc.map((heading) => (
              <a
                key={heading.id}
                href={`#${heading.id}`}
                className={`block text-sm transition-colors hover:text-teal ${
                  heading.level === 1 ? 'text-text-primary' : 'text-text-muted'
                }`}
              >
                {heading.text}
              </a>
            )) : (
              <span className="text-sm text-text-muted">No sections</span>
            )}
          </nav>
        </div>
      </aside>
    </div>
  );
}
