/** Strips spaces and unifies the punctuation variants OCR tends to swap. */
export function normalize(text: string): string {
  return text
    .replace(/\s+/g, '')
    .replace(/[·・•‧]/g, '·')
    .replace(/[+＋]/g, '+')
    .replace(/[：:]/g, ':')
    .toLowerCase();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost);
    }
    prev = curr;
  }
  return prev[b.length]!;
}

export type Match = {
  value: string;
  /** 1 means identical; 0 means nothing in common. */
  score: number;
};

/** Picks the closest candidate, tolerating the odd character OCR gets wrong. */
export function bestMatch(text: string, candidates: readonly string[], minScore = 0.72): Match | null {
  const needle = normalize(text);
  if (!needle) return null;

  let best: Match | null = null;
  for (const candidate of candidates) {
    const hay = normalize(candidate);
    const distance = levenshtein(needle, hay);
    const score = 1 - distance / Math.max(needle.length, hay.length);
    if (!best || score > best.score) best = { value: candidate, score };
  }
  return best && best.score >= minScore ? best : null;
}

/**
 * True when `needle` appears somewhere inside `text`, tolerating OCR slips. Unlike bestMatch this
 * ignores surrounding words, so a short anchor still matches a button that spells out more.
 */
export function containsFuzzy(text: string, needle: string, minScore = 0.72): boolean {
  const hay = normalize(text);
  const pin = normalize(needle);
  if (!hay || !pin) return false;
  if (hay.includes(pin)) return true;
  if (hay.length <= pin.length) return bestMatch(hay, [pin], minScore) !== null;

  for (let i = 0; i + pin.length <= hay.length; i++) {
    const score = 1 - levenshtein(hay.slice(i, i + pin.length), pin) / pin.length;
    if (score >= minScore) return true;
  }
  return false;
}
