import { getPendingCardIds, getActiveCardId } from './activeCard';

describe('activeCard', () => {
  test('перша невирішена картка є активною, а решта невирішених — у черзі', () => {
    const messages = [
      { _id: 'm1', kind: 'message', content: 'Hello' },
      { _id: 'm2', kind: 'suggestion', relatedSuggestionId: 's1' },
      { _id: 'm3', kind: 'policy-choice', payload: { policyKey: 'policy.ai_mode' } },
      { _id: 'm4', kind: 'approve-all', payload: { sections: ['course_overview', 'course_schedule'] } },
    ];
    const suggestions = [{ id: 's1', status: 'pending', section: 'grading' }];
    const state = { policies: [{ key: 'policy.ai_mode', optionKey: null, source: 'empty' }] };
    const readiness = {
      sections: {
        course_overview: { status: 'draft', approved: false },
        course_schedule: { status: 'draft', approved: false },
      },
    };

    const pending = getPendingCardIds({ messages, suggestions, state, readiness });
    expect(pending).toEqual(['m2', 'm3', 'm4']);
    expect(getActiveCardId({ messages, suggestions, state, readiness })).toBe('m2');
  });

  test('вирішені картки (accepted/rejected, обрана політика, схвалені секції approve-all) не потрапляють у чергу', () => {
    const messages = [
      { _id: 'm1', kind: 'suggestion', relatedSuggestionId: 's1' },
      { _id: 'm2', kind: 'suggestion', relatedSuggestionId: 's2' },
      { _id: 'm3', kind: 'policy-choice', payload: { policyKey: 'policy.ai_mode' } },
      { _id: 'm4', kind: 'approve-all', payload: { sections: ['course_overview'] } },
      { _id: 'm5', kind: 'suggestion', relatedSuggestionId: 's3' },
    ];
    const suggestions = [
      { id: 's1', status: 'accepted', section: 'grading' },
      { id: 's2', status: 'rejected', section: 'learning_outcomes' },
      { id: 's3', status: 'pending', section: 'materials' },
    ];
    const state = {
      policies: [{ key: 'policy.ai_mode', optionKey: 'assisted', source: 'library' }],
    };
    const readiness = {
      sections: {
        course_overview: { status: 'approved', approved: true },
      },
    };

    const pending = getPendingCardIds({ messages, suggestions, state, readiness });
    expect(pending).toEqual(['m5']);
    expect(getActiveCardId({ messages, suggestions, state, readiness })).toBe('m5');
  });

  test('якщо для однієї пропозиції є кілька повідомлень у стрічці, враховується лише останнє', () => {
    const messages = [
      { _id: 'm-old', kind: 'suggestion', relatedSuggestionId: 's1' },
      { _id: 'm-new', kind: 'suggestion', relatedSuggestionId: 's1' },
    ];
    const suggestions = [{ id: 's1', status: 'pending', section: 'grading' }];

    const pending = getPendingCardIds({ messages, suggestions });
    expect(pending).toEqual(['m-new']);
    expect(getActiveCardId({ messages, suggestions })).toBe('m-new');
  });
});
