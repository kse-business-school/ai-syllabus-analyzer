/**
 * Section groups mapping and readiness calculation.
 * Maps backend 11 template sections into 8 logical UI sections.
 * Used identically in Workspace (Header, Structure Panel) and Cabinet (SyllabiTab).
 */

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

/**
 * Resolves the status for a logical UI section.
 * Status values: 'approved' | 'attention' | 'draft_in_chat' | 'needs_review' | 'empty'
 */
export function resolveGroupStatus(group, backendSections = {}, state = {}) {
  const { backendKeys, isVirtualAi } = group;

  if (isVirtualAi) {
    const aiMode = state?.slots?.['policy.ai_mode'];
    if (backendSections?.policies === 'approved' && aiMode) {
      return 'approved';
    }
    if (!aiMode) {
      return 'empty';
    }
    return backendSections?.policies || 'needs_review';
  }

  const statuses = backendKeys.map((k) => backendSections?.[k] || 'empty');

  // If all are approved -> group approved
  if (statuses.every((s) => s === 'approved')) {
    return 'approved';
  }

  // If any has attention / blockers -> attention
  if (statuses.some((s) => s === 'attention')) {
    return 'attention';
  }

  // If any has draft_in_chat -> draft_in_chat
  if (statuses.some((s) => s === 'draft_in_chat')) {
    return 'draft_in_chat';
  }

  // If all are empty -> empty
  if (statuses.every((s) => s === 'empty')) {
    return 'empty';
  }

  return 'needs_review';
}

/**
 * Unified calculation of readiness across 8 logical groups.
 * Returns { groups, approvedCount, totalCount: 8, percent, isEmpty, label }
 */
export function computeGroupedReadiness(readiness, state) {
  const backendSections = readiness?.sections || {};

  const groups = UI_SECTIONS.map((sec) => {
    const status = resolveGroupStatus(sec, backendSections, state);
    return {
      ...sec,
      status,
      isApproved: status === 'approved',
      isEmpty: status === 'empty',
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
    label: allEmpty ? '—' : `${percent}% · ${approvedCount} of ${totalCount} approved`,
  };
}
