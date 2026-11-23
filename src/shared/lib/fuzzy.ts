// Small subsequence matcher for in-memory lists (the switcher). The M2 palette uses FTS5 + Rust ranking.

/**
 * Returns a score (higher is better) or -1 if `query` is not a subsequence of `text`.
 * Rewards contiguous runs and matches at word starts (after / - _ . or space).
 */
export function fuzzyScore(query: string, text: string): number {
  if (!query) return 0;
  const q = query.toLowerCase();
  const t = text.toLowerCase();

  // Fast path: plain substring wins big, earlier and at a word start wins more.
  const idx = t.indexOf(q);
  if (idx >= 0) {
    const atStart = idx === 0 || "/-_. ".includes(t[idx - 1]);
    return 1000 - idx + (atStart ? 200 : 0) - (t.length - q.length) * 0.5;
  }

  let score = 0;
  let ti = 0;
  let run = 0;
  for (let qi = 0; qi < q.length; qi++) {
    const c = q[qi];
    let found = false;
    while (ti < t.length) {
      if (t[ti] === c) {
        const atStart = ti === 0 || "/-_. ".includes(t[ti - 1]);
        run = run > 0 && t[ti - 1] === q[qi - 1] ? run + 1 : 1;
        score += 1 + run * 2 + (atStart ? 8 : 0);
        ti++;
        found = true;
        break;
      }
      ti++;
      run = 0;
    }
    if (!found) return -1;
  }
  return score - t.length * 0.1;
}
