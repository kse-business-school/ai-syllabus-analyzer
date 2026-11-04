import valueText from './valueText';

test('summarizes instructor photos without exposing embedded image data', () => {
  const text = valueText([{ id: 'instructor-1', name: 'Alex', email: 'alex@example.org', photo: 'data:image/jpeg;base64,private-image-bytes' }]);
  expect(text).toBe('Alex\nEmail: alex@example.org\nPhoto: Included');
  expect(text).not.toContain('base64');
});
