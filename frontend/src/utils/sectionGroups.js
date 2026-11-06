// Мапінг 11 розділів шаблону бекенду (TemplateSection) у 8 логічних груп UI — лише для відображення.
// Відсоток Readiness і лічильник затверджених беруться з бекенду (readiness.score, readiness.counts):
// одна формула для Workspace, лівої панелі, Cabinet і метрики ready100 (аудит A08).

export const UI_SECTIONS = [
  {
    id: 'at_a_glance',
    title: 'At a Glance',
    docNumber: null,
    backendKeys: ['at_a_glance'],
  },
  {
    id: 'summary_outcomes',
    title: 'Summary',
    docNumber: '1',
    backendKeys: [
      'course_info',
      'short_description',
      'course_objectives',
      'learning_outcomes',
      'connection_to_capstone',
    ],
  },
  {
    id: 'instructor',
    title: 'Instructor',
    docNumber: '2',
    backendKeys: ['instructor'],
  },
  {
    id: 'schedule',
    title: 'Schedule',
    docNumber: '3',
    backendKeys: ['schedule'],
  },
  {
    id: 'assessment',
    title: 'Assessment',
    docNumber: '4',
    backendKeys: ['assessment'],
  },
  {
    id: 'materials',
    title: 'Materials',
    docNumber: '5',
    backendKeys: ['materials'],
  },
  {
    id: 'policies',
    title: 'Policies',
    docNumber: '6',
    backendKeys: ['policies'],
  },
  {
    id: 'ai_policy',
    title: 'Use of AI',
    docNumber: '6.1',
    backendKeys: ['policies'],
    isVirtualAi: true,
  },
];

// Нормалізує запис readiness.sections[key] за контрактом docs/api-v5.md §4:
// { status: 'empty'|'draft'|'approved', complete, approved, gaps: [String], checks: { critical, high, other } }.
// Для сумісності з простими фікстурами також приймає рядкове значення статусу.
export function normalizeSectionReadiness(raw) {
  if (!raw) {
    return {
      status: 'empty',
      complete: false,
      approved: false,
      gaps: [],
      checks: { critical: 0, high: 0, other: 0 },
    };
  }
  if (typeof raw === 'string') {
    const isApproved = raw === 'approved';
    return {
      status: raw,
      complete: isApproved,
      approved: isApproved,
      gaps: [],
      checks: { critical: 0, high: 0, other: 0 },
    };
  }
  const approved = Boolean(raw.approved || raw.status === 'approved');
  const status = approved ? 'approved' : (raw.status || 'empty');
  return {
    status,
    complete: Boolean(raw.complete ?? approved),
    approved,
    gaps: Array.isArray(raw.gaps) ? raw.gaps : [],
    checks: {
      critical: Number(raw.checks?.critical || 0),
      high: Number(raw.checks?.high || 0),
      other: Number(raw.checks?.other || 0),
    },
  };
}

// За контрактом backend/services/syllabusState/schema.js політики лежать у масиві state.policies[]
// з полем key ('policy.ai_mode', 'policy.ai_place' тощо). Режим вважається обраним, коли задано
// optionKey з бібліотеки або власний підтверджений текст викладача.
export function hasAiModeSelected(state) {
  if (Array.isArray(state?.policies)) {
    const aiPolicy = state.policies.find((p) => p?.key === 'policy.ai_mode');
    if (!aiPolicy) return false;
    return Boolean(
      aiPolicy.optionKey
      || (['instructor_directed', 'fixture_edited'].includes(aiPolicy.source) && aiPolicy.text)
    );
  }
  if (state?.slots && 'policy.ai_mode' in state.slots) {
    return Boolean(state.slots['policy.ai_mode']);
  }
  return false;
}

// Визначає статус логічної групи з 8 розділів UI:
// 'approved' | 'attention' | 'empty' | 'needs_review'.
// Статус 'draft_in_chat' тут не повертається, оскільки мутабельні пропозиції чату (suggestions[])
// не входять у readiness та state; групу з чернеткою в роботі позначаємо як 'needs_review' або 'attention'.
export function resolveGroupStatus(group, backendSections = {}, state = {}) {
  const { backendKeys, isVirtualAi } = group;

  if (isVirtualAi) {
    const polSec = normalizeSectionReadiness(backendSections?.policies);
    const aiSelected = hasAiModeSelected(state);
    if (!aiSelected) return 'empty';
    if (polSec.approved) return 'approved';
    if (polSec.checks.critical + polSec.checks.high > 0) return 'attention';
    return 'needs_review';
  }

  const entries = backendKeys.map((k) => normalizeSectionReadiness(backendSections?.[k]));

  if (entries.every((e) => e.approved)) {
    return 'approved';
  }

  if (entries.some((e) => !e.approved && (e.checks.critical + e.checks.high) > 0)) {
    return 'attention';
  }

  if (entries.every((e) => e.status === 'empty')) {
    return 'empty';
  }

  return 'needs_review';
}

// Групи для відображення + Readiness з бекенду:
// повертає { groups, approvedCount, totalCount, percent, isEmpty, isAllApproved, label },
// де approvedCount / totalCount — затверджені / обов'язкові розділи шаблону (readiness.counts), percent — readiness.score.
export function computeGroupedReadiness(readiness, state) {
  const backendSections = readiness?.sections || {};

  const groups = UI_SECTIONS.map((sec) => {
    const status = resolveGroupStatus(sec, backendSections, state);
    const entries = sec.backendKeys.map((k) => ({
      key: k,
      ...normalizeSectionReadiness(backendSections?.[k]),
    }));

    const aiSelected = sec.isVirtualAi ? hasAiModeSelected(state) : true;
    const gapsByKey = sec.isVirtualAi
      ? (aiSelected ? [] : [{ key: 'policies', gap: 'Use of AI mode is not selected' }])
      : entries.flatMap((e) => e.gaps.map((gap) => ({ key: e.key, gap })));
    const gaps = gapsByKey.map((item) => item.gap);

    const checks = entries.reduce(
      (acc, e) => ({
        critical: acc.critical + e.checks.critical,
        high: acc.high + e.checks.high,
        other: acc.other + e.checks.other,
      }),
      { critical: 0, high: 0, other: 0 }
    );

    const complete = sec.isVirtualAi
      ? Boolean(entries[0]?.complete && aiSelected)
      : entries.every((e) => e.complete && e.status !== 'empty');

    return {
      ...sec,
      status,
      isApproved: status === 'approved',
      isEmpty: status === 'empty',
      complete,
      gaps,
      gapsByKey,
      checks,
    };
  });

  const allEmpty = groups.every((g) => g.isEmpty);
  const counts = readiness?.counts || {};
  const approvedCount = Number(counts.approved || 0);
  const totalCount = Number(counts.required || 0);
  const score = Number.isFinite(readiness?.score) ? readiness.score : null;
  // Порожній силабус без затверджених розділів — «—», а не 0% і тим паче не 100%
  const isEmpty = (allEmpty && !approvedCount) || score === null;
  const percent = isEmpty ? null : score;

  return {
    groups,
    approvedCount,
    totalCount,
    percent,
    isEmpty,
    isAllApproved: totalCount > 0 && approvedCount === totalCount,
    label: isEmpty ? '—' : `${percent}% · ${approvedCount} of ${totalCount} sections approved`,
  };
}

// Статус одного розділу шаблону (одиниця Approve і лічильника Readiness, B-5.3/B-5.4):
// 'approved' | 'ready' (пороги пройдено, відкритих перевірок ≥ high немає, але ще не затверджено) |
// 'attention' | 'draft' | 'empty'.
export function sectionStatus(raw) {
  const s = normalizeSectionReadiness(raw);
  if (s.approved) return 'approved';
  if (s.checks.critical + s.checks.high > 0) return 'attention';
  if (s.status === 'empty') return 'empty';
  if (s.complete) return 'ready';
  return 'draft';
}

export const SECTION_STATUS_LABELS = {
  approved: 'Approved',
  ready: 'Ready to approve',
  attention: 'Needs attention',
  draft: 'In progress',
  empty: 'Empty',
};
