/**
 * Translate an auto-tag key to the current locale.
 * Falls back to the raw English string for user-defined tags that have no translation entry.
 */
export function translateTag(tag, t) {
  return t(`tags.${tag}`, { defaultValue: tag });
}
