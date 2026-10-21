// utils/hashtagExtractor.js — Issue #212
/**
 * Extract and normalise hashtags from a block of text.
 *
 * Rules:
 *   - A hashtag starts with '#' followed by one or more word characters.
 *   - Tags are lowercased and de-duplicated.
 *   - The leading '#' is stripped; only the slug is returned.
 *   - Tags longer than 100 characters are discarded.
 *
 * @param {string} text
 * @returns {string[]} Array of unique, normalised tag slugs.
 *
 * @example
 *   extractHashtags("Alhamdulillah #Islam #Quran #quran is beautiful!")
 *   // → ["islam", "quran"]
 */
export const extractHashtags = (text) => {
  if (!text || typeof text !== "string") return [];

  const pattern = /#([\w\u0600-\u06FF]+)/gu; // Arabic Unicode range included
  const seen = new Set();
  const tags = [];

  let match;
  while ((match = pattern.exec(text)) !== null) {
    const tag = match[1].toLowerCase();
    if (tag.length <= 100 && !seen.has(tag)) {
      seen.add(tag);
      tags.push(tag);
    }
  }

  return tags;
};
