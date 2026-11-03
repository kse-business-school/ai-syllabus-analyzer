// Чиста функція вибору активної картки та черги очікування в чаті.
// Правило: у потоці повідомлень лише перша невирішена картка є активною,
// решта невирішених чекають у черзі ("Up next"), а вирішені — згорнуті.

export const payloadOf = (m) => m?.payload || m || {};

export function isPolicyDecided(state, policyKey) {
  if (!policyKey) return false;
  const policies = state?.policies || [];
  const p = policies.find((x) => x.key === policyKey);
  if (!p) return false;
  return Boolean(p.optionKey) || ['instructor_directed', 'fixture_edited'].includes(p.source);
}

export function isSectionApproved(readiness, sectionKey) {
  const entry = readiness?.sections?.[sectionKey];
  if (!entry) return false;
  if (typeof entry === 'string') return entry === 'approved';
  return Boolean(entry.approved) || entry.status === 'approved';
}

export function getPendingCardIds({
  messages = [],
  suggestions = [],
  suggestionById: suggestionByIdProp,
  latest: latestProp,
  state = null,
  readiness = null,
} = {}) {
  const suggestionById =
    suggestionByIdProp instanceof Map
      ? suggestionByIdProp
      : new Map((suggestions || []).map((s) => [s.id, s]));

  const latest =
    latestProp instanceof Map
      ? latestProp
      : (() => {
          const map = new Map();
          (messages || []).forEach((m) => {
            if (m?.kind === 'suggestion' && m.relatedSuggestionId) {
              map.set(m.relatedSuggestionId, m._id);
            }
          });
          return map;
        })();

  return (messages || [])
    .filter((m) => {
      if (!m || !m._id) return false;
      const payload = payloadOf(m);
      if (m.kind === 'suggestion') {
        const sg = suggestionById.get(m.relatedSuggestionId);
        return Boolean(sg) && latest.get(sg.id) === m._id && sg.status === 'pending';
      }
      if (m.kind === 'policy-choice') {
        return !isPolicyDecided(state, payload.policyKey);
      }
      if (m.kind === 'approve-all') {
        const keys = payload.sections || [];
        return keys.length > 0 && keys.some((k) => !isSectionApproved(readiness, k));
      }
      return false;
    })
    .map((m) => m._id);
}

export function getActiveCardId(params) {
  const ids = getPendingCardIds(params);
  return ids[0] || null;
}
