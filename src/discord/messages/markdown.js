export function escapeMarkdown(text) {
  return String(text).replace(/[\\`*_~|<>\[\]]/g, '\\$&');
}
