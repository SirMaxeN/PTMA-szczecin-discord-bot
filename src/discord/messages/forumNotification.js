import { escapeMarkdown } from './markdown.js';

export const POST_EXCERPT_LIMIT = 500;

export function forumNotification(post) {
  const forumName = post.forumName || 'Forum';
  const limit =
    Number.isInteger(post.contentLimit) &&
    post.contentLimit >= 100 &&
    post.contentLimit <= 1500 &&
    post.contentLimit % 100 === 0
      ? post.contentLimit
      : POST_EXCERPT_LIMIT;
  const characters = Array.from(post.content || '');
  const excerpt =
    characters.length > limit
      ? characters
          .slice(0, limit - 1)
          .join('')
          .trimEnd() + '…'
      : characters.join('');
  const escapedContent = escapeMarkdown(excerpt);
  const text = post.showContent && post.content ? `\n\n${escapedContent}` : '';
  return {
    embeds: [
      {
        title: post.title.slice(0, 256),
        url: post.url,
        color: 0x245b9e,
        description: `Nowy post na forum\nDział: **${escapeMarkdown(post.forum || forumName).slice(0, 300)}**\nAutor: **${escapeMarkdown(post.author).slice(0, 300)}**${text}`,
        footer: {
          text: post.publishedAt ? `${forumName} · ${post.publishedAt}` : forumName,
        },
      },
    ],
    allowed_mentions: { parse: [] },
  };
}
