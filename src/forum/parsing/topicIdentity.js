export function topicIdentity(value, root) {
  try {
    const url = new URL(value);
    const forum = new URL(root);
    if (
      url.protocol !== 'https:' ||
      url.origin !== forum.origin ||
      !url.pathname.startsWith(`${forum.pathname.replace(/\/$/, '')}/topic/`)
    )
      return null;
    const postId = Number(url.hash.match(/^#postid-(\d+)$/)?.[1]);
    url.search = '';
    url.hash = '';
    return {
      topicUrl: url.href,
      postId: Number.isSafeInteger(postId) && postId > 0 ? postId : null,
    };
  } catch {
    return null;
  }
}

export function forumMessageReference(message, root) {
  for (const embed of message.embeds || []) {
    const reference = topicIdentity(embed.url, root);
    if (reference?.postId) return reference;
  }
  return null;
}
