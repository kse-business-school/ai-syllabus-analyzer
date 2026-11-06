import valueText from './valueText';

test('summarizes instructor photos without exposing embedded image data', () => {
  const text = valueText([{ id: 'instructor-1', name: 'Alex', email: 'alex@example.org', photo: 'data:image/jpeg;base64,private-image-bytes' }]);
  expect(text).toBe('Alex\nEmail: alex@example.org\nPhoto: Included');
  expect(text).not.toContain('base64');
});

test('hides empty lists, id lists and service flags; shows PLO links compactly (B-10.4)', () => {
  const text = valueText([
    { id: 'clo1', text: 'Analyse risks', plo: [], assessmentIds: [] },
    { id: 'clo2', text: 'Build a model', plo: [{ code: 'ПРН1', coverage: 'full', confirmed: false }], assessmentIds: ['as1'] },
  ]);
  expect(text).toBe('Analyse risks\nBuild a model\nPLO: ПРН1 (full)');
});
