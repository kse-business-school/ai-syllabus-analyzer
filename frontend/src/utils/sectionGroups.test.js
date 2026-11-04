import { UI_SECTIONS, resolveGroupStatus, computeGroupedReadiness } from './sectionGroups';

const makeSec = (over = {}) => ({
  status: 'empty',
  complete: false,
  approved: false,
  gaps: [],
  checks: { critical: 0, high: 0, other: 0 },
  ...over,
});

describe('sectionGroups & computeGroupedReadiness', () => {
  test('returns — when all sections are empty', () => {
    const res = computeGroupedReadiness({ sections: {} }, { policies: [] });
    expect(res.isEmpty).toBe(true);
    expect(res.percent).toBeNull();
    expect(res.approvedCount).toBe(0);
    expect(res.totalCount).toBe(8);
    expect(res.label).toBe('—');
  });

  test('counts a single approved section from contract object', () => {
    const readiness = {
      sections: {
        at_a_glance: makeSec({ status: 'approved', complete: true, approved: true }),
      },
    };
    const res = computeGroupedReadiness(readiness, { policies: [] });
    expect(res.isEmpty).toBe(false);
    expect(res.approvedCount).toBe(1);
    expect(res.percent).toBe(13);
    expect(res.label).toBe('13% · 1 of 8 approved');
    const glance = res.groups.find((g) => g.id === 'at_a_glance');
    expect(glance.status).toBe('approved');
    expect(glance.isApproved).toBe(true);
  });

  test('Summary & Outcomes is approved only when all 5 subsections are approved', () => {
    const summaryGroup = UI_SECTIONS.find((g) => g.id === 'summary_outcomes');
    const fourApproved = {
      course_info: makeSec({ status: 'approved', complete: true, approved: true }),
      short_description: makeSec({ status: 'approved', complete: true, approved: true }),
      course_objectives: makeSec({ status: 'approved', complete: true, approved: true }),
      learning_outcomes: makeSec({ status: 'approved', complete: true, approved: true }),
      connection_to_capstone: makeSec({ status: 'draft', complete: false, approved: false, gaps: ['Connection to the capstone'] }),
    };
    expect(resolveGroupStatus(summaryGroup, fourApproved, {})).toBe('needs_review');

    const allFiveApproved = {
      ...fourApproved,
      connection_to_capstone: makeSec({ status: 'approved', complete: true, approved: true }),
    };
    expect(resolveGroupStatus(summaryGroup, allFiveApproved, {})).toBe('approved');
  });

  test('marks group as attention when unapproved section has critical or high checks', () => {
    const assessmentGroup = UI_SECTIONS.find((g) => g.id === 'assessment');
    const withCritical = {
      assessment: makeSec({
        status: 'draft',
        approved: false,
        checks: { critical: 1, high: 0, other: 0 },
      }),
    };
    expect(resolveGroupStatus(assessmentGroup, withCritical, {})).toBe('attention');

    // Коли розділ уже затверджено, статус лишається approved
    const approvedWithCheck = {
      assessment: makeSec({
        status: 'approved',
        approved: true,
        checks: { critical: 1, high: 0, other: 0 },
      }),
    };
    expect(resolveGroupStatus(assessmentGroup, approvedWithCheck, {})).toBe('approved');
  });

  test('Use of AI virtual group checks state.policies[policy.ai_mode] and policies approval', () => {
    const aiGroup = UI_SECTIONS.find((g) => g.id === 'ai_policy');

    // Режим ШІ не обрано -> empty навіть якщо policies має чернетку або затверджений без політики
    expect(
      resolveGroupStatus(
        aiGroup,
        { policies: makeSec({ status: 'draft', approved: false }) },
        { policies: [{ key: 'policy.ai_mode', mode: 'library', optionKey: null, text: null, source: null }] }
      )
    ).toBe('empty');

    // Режим ШІ обрано з бібліотеки, але розділ policies ще не затверджений -> needs_review
    expect(
      resolveGroupStatus(
        aiGroup,
        { policies: makeSec({ status: 'draft', approved: false }) },
        { policies: [{ key: 'policy.ai_mode', mode: 'library', optionKey: 'ai_mode_disclosure', text: 'Permitted', source: 'fixture' }] }
      )
    ).toBe('needs_review');

    // Режим ШІ обрано і розділ policies затверджений -> approved
    expect(
      resolveGroupStatus(
        aiGroup,
        { policies: makeSec({ status: 'approved', complete: true, approved: true }) },
        { policies: [{ key: 'policy.ai_mode', mode: 'library', optionKey: 'ai_mode_disclosure', text: 'Permitted', source: 'fixture' }] }
      )
    ).toBe('approved');

    // Власний текст викладача (instructor_directed) + затверджений policies -> approved
    expect(
      resolveGroupStatus(
        aiGroup,
        { policies: makeSec({ status: 'approved', complete: true, approved: true }) },
        { policies: [{ key: 'policy.ai_mode', mode: 'library', optionKey: null, text: 'Custom AI rule', source: 'instructor_directed' }] }
      )
    ).toBe('approved');
  });
});
