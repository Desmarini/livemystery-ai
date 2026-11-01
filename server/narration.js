/**
 * Replaceable narration seam. The MVP uses fixed authored text and makes no
 * AI request. A future provider can receive a narration context and return a
 * line of text without changing the story/state engine.
 */
export function createNarrator(provider = deterministicNarrator) {
  return { narrate: (context) => provider(context) };
}

export function deterministicNarrator(context) {
  const lead = context?.lead;
  return lead ? `The team found a lead in ${lead}. What does it mean?` : 'The observatory is waiting for its next move.';
}
