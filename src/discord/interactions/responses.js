export function reply(content, components = []) {
  return { type: 4, data: { content, flags: 64, components, allowed_mentions: { parse: [] } } };
}

export function update(response) {
  const { flags, ...data } = response.data;
  return { type: 7, data };
}

export function defer(complete) {
  return { response: { type: 5, data: { flags: 64 } }, complete };
}
