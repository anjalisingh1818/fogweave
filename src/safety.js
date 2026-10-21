/**
 * Polite refusals, from shared/safety.v1.json (the same list the server uses),
 * so a request for private people, harmful how-tos or restricted sources (dark
 * web, leaks, paywall or login bypass) is refused even in the Demo scene.
 */
import RULES from '../shared/safety.v1.json' with { type: 'json' };

const compiled = Object.fromEntries(['private_person', 'harmful', 'restricted'].map((k) => [k, RULES[k].map((p) => new RegExp(p))]));

/** The refusal message, or null when the request is fine. */
export function checkRequest(text) {
  const t = String(text || '').toLowerCase();
  for (const kind of ['private_person', 'harmful', 'restricted']) {
    if (compiled[kind].some((re) => re.test(t))) return RULES.messages[kind];
  }
  return null;
}
