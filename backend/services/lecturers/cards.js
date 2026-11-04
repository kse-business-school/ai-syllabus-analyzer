const { toInstructor, hasInstructor, sameProfile } = require('./profile');

// Повертає картку підтвердження; трек 2 зберігає дані файлу й окремо пропонує профіль.
function prepareInstructor(state, resolved) {
  const first = state.instructors[0];
  const profileInstructor = toInstructor(resolved, first?.id);
  if (first && !first.photo && profileInstructor.photo && sameProfile(first, profileInstructor)) first.photo = profileInstructor.photo;
  const empty = !state.instructors.some(hasInstructor);
  if (empty) state.instructors = [profileInstructor];
  const differs = !empty && !sameProfile(first, profileInstructor);
  const current = structuredClone(state.instructors);
  return {
    origin: 'interviewer', kind: 'choice', severity: 'info',
    title: differs ? 'Your instructor details differ from your profile' : 'Here is your profile. Is it up to date?',
    description: differs ? 'The instructor details in your file have been kept. Would you like to use your lecturer profile?' : 'Review your instructor details below.',
    target: { section: 'instructor', path: 'instructors[]' },
    // Чернетка містить basisHash, але довірені дані профілю не скануємо як вигадки моделі.
    choiceBasis: true,
    options: differs ? [
      { id: 'use_profile', label: 'Use my profile', value: [profileInstructor, ...current.slice(1)], writeBack: false },
      { id: 'keep', label: 'Keep the details from my file', value: current, writeBack: false },
      { id: 'update', label: 'Update', value: null, writeBack: false },
    ] : [
      { id: 'yes', label: "Yes, it's up to date", value: current, writeBack: false },
      { id: 'update', label: 'Update', value: null, writeBack: false },
    ],
  };
}

module.exports = { prepareInstructor };
