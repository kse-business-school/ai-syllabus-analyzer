// Мапінг 11 розділів шаблону бекенду (TemplateSection) у 8 логічних груп UI
// та єдиний розрахунок Readiness для Workspace (Header, ліва панель) і Cabinet.

export const UI_SECTIONS = [
  {
    id: 'at_a_glance',
    title: 'At a Glance',
    docNumber: null,
    backendKeys: ['at_a_glance'],
  },
  {
    id: 'summary_outcomes',
    title: 'Summary & Outcomes',
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
    title: 'Course Schedule',
    docNumber: '3',
    backendKeys: ['schedule'],
  },
  {
    id: 'assessment',
    title: 'Assessment & Grading',
    docNumber: '4',
    backendKeys: ['assessment'],
  },
  {
    id: 'materials',
    title: 'Materials & Resources',
    docNumber: '5',
    backendKeys: ['materials'],
  },
  {
    id: 'policies',
    title: 'Course Policies',
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

// Єдиний розрахунок Readiness по 8 групах:
// повертає { groups, approvedCount, totalCount: 8, percent, isEmpty, isAllApproved, label }.
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
  const approvedCount = groups.filter((g) => g.isApproved).length;
  const totalCount = groups.length; // 8
  const percent = allEmpty ? null : Math.round((approvedCount / totalCount) * 100);

  return {
    groups,
    approvedCount,
    totalCount,
    percent,
    isEmpty: allEmpty,
    isAllApproved: approvedCount === totalCount,
    label: allEmpty ? '—' : `${percent}% · ${approvedCount} of ${totalCount} approved`,
  };
}
