import { parsePostDate } from './parsePostDate.js';

export function parsePosts($, pageUrl, root, { name = 'Forum', breadcrumbPrefix = '' } = {}) {
  const title = $('#af-wrapper h1.main-title-topic').text().trim();
  const breadcrumb = $(
    '#af-wrapper #forum-breadcrumbs a[href*="/forum/forum/"], #af-wrapper .forum-breadcrumbs a[href*="/forum/forum/"]',
  )
    .last()
    .text()
    .trim();
  const forum =
    (breadcrumbPrefix && breadcrumb.startsWith(breadcrumbPrefix)
      ? breadcrumb.slice(breadcrumbPrefix.length).trim()
      : breadcrumb) || name;
  return $('#af-wrapper .post-element[id^="postid-"]')
    .toArray()
    .map((el) => {
      const row = $(el);
      const id = Number(row.attr('id').replace('postid-', ''));
      const authorBlock = row.find('.post-author-block-name').first();
      // Deleted accounts have plain text instead of a profile link.
      const author =
        authorBlock.find('.profile-link').first().text().trim() ||
        authorBlock.clone().find('.mention-nice-name').remove().end().text().trim();
      const url = new URL(row.find('.forum-post-date a').first().attr('href'), pageUrl);
      if (
        !title ||
        !author ||
        !Number.isSafeInteger(id) ||
        url.origin !== new URL(root).origin ||
        url.hash !== `#postid-${id}`
      )
        throw new Error('Niekompletne dane postu.');
      // Never reuse action URLs containing nonces or private session information.
      for (const key of [...url.searchParams.keys()])
        if (key !== 'part') url.searchParams.delete(key);
      const message = row.find('.post-message').clone();
      message
        .find('[id^="post-quote-container-"], [hidden], [style*="display: none"], script, style')
        .remove();
      message.find('img').replaceWith(' [zdjęcie] ');
      message.find('br').replaceWith('\n');
      message.find('p, div, li, blockquote').append('\n');
      const content = message
        .text()
        .replace(/[ \t]+/g, ' ')
        .replace(/\n\s*\n/g, '\n\n')
        .trim()
        .slice(0, 10000);
      const publishedAt = parsePostDate(row.find('.forum-post-date').first());
      return {
        id,
        author,
        title,
        forum,
        content,
        url: url.href,
        ...(publishedAt ? { publishedAt } : {}),
      };
    });
}
