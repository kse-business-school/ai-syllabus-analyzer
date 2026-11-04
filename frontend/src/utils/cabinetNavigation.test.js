import { cabinetGroupsFor, cabinetViewFor } from './cabinetNavigation';

test('instructor navigation contains My work and Library, with settings in the same cabinet', () => {
  const groups = cabinetGroupsFor('instructor');
  expect(groups.map(group => group.label)).toEqual(['My work', 'Library']);
  expect(groups[0].items.map(item => item.id)).toEqual(['my_syllabi', 'account']);
  expect(groups[1].items.map(item => item.id)).toEqual(['policies', 'outcomes', 'assessment']);
});

test.each(['manager', 'director'])('%s gets programme screens without administration', role => {
  expect(cabinetGroupsFor(role).map(group => group.label)).toEqual(['My work', 'Programme', 'Library']);
  expect(cabinetViewFor(role, 'all_syllabi')).toBe('all_syllabi');
  expect(cabinetViewFor(role, 'users')).toBe('my_syllabi');
});

test('unauthorised or unknown deep links resolve to My syllabi', () => {
  expect(cabinetViewFor('instructor', 'all_syllabi')).toBe('my_syllabi');
  expect(cabinetViewFor('admin', 'users')).toBe('users');
  expect(cabinetViewFor('admin', 'missing')).toBe('my_syllabi');
});
