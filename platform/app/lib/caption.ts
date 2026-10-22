import { renderDocument } from '@tanstack/markdown/html'
import { parseMarkdown } from '@tanstack/markdown/parser'
import type { BlockNode, InlineNode } from '@tanstack/markdown'

import { formatLinkText, splitLinks } from './links.ts'

// Captions are Markdown, written like a tweet: bare URLs become shortened links and every line
// break is kept, not just the ones Markdown would keep. Links open in a new tab, and raw HTML is
// escaped.
export function renderCaption(caption: string): string {
  let document = parseMarkdown(caption)
  document.children = document.children.map(transformBlock)
  return renderDocument(document).replaceAll('<a href=', '<a target="_blank" rel="noopener" href=')
}

// A caption's text without its Markdown, one block or list item per line, for page titles and
// descriptions.
export function captionText(caption: string): string {
  return parseMarkdown(caption).children.map(blockText).join('\n')
}

function transformBlock(node: BlockNode): BlockNode {
  switch (node.type) {
    case 'paragraph':
    case 'heading':
      return { ...node, children: transformInlines(node.children) }
    case 'list':
      return {
        ...node,
        items: node.items.map((item) => ({ ...item, children: item.children.map(transformBlock) })),
      }
    case 'blockquote':
      return { ...node, children: node.children.map(transformBlock) }
    default:
      return node
  }
}

function transformInlines(nodes: InlineNode[]): InlineNode[] {
  return nodes.flatMap((node): InlineNode[] => {
    switch (node.type) {
      case 'text':
        return splitLinks(node.value).flatMap((part): InlineNode[] =>
          typeof part === 'string'
            ? splitBreaks(part)
            : [
                {
                  type: 'link',
                  href: part.url,
                  children: [{ type: 'text', value: formatLinkText(part.url) }],
                },
              ],
        )
      case 'strong':
      case 'emphasis':
      case 'strike':
        return [{ ...node, children: transformInlines(node.children) }]
      default:
        return [node]
    }
  })
}

function splitBreaks(text: string): InlineNode[] {
  return text
    .split('\n')
    .flatMap((line, index): InlineNode[] => [
      ...(index > 0 ? [{ type: 'break' } as const] : []),
      ...(line ? [{ type: 'text', value: line } as const] : []),
    ])
}

function blockText(node: BlockNode): string {
  switch (node.type) {
    case 'paragraph':
    case 'heading':
      return inlineText(node.children)
    case 'list':
      return node.items.map((item) => item.children.map(blockText).join('\n')).join('\n')
    case 'blockquote':
      return node.children.map(blockText).join('\n')
    case 'code':
      return node.value
    default:
      return ''
  }
}

function inlineText(nodes: InlineNode[]): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case 'text':
        case 'inlineCode':
          return node.value
        case 'break':
          return '\n'
        case 'image':
          return node.alt
        default:
          return 'children' in node ? inlineText(node.children) : ''
      }
    })
    .join('')
}
