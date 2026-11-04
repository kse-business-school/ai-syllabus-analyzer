import { ALL_ROLES, PROGRAMME_ROLES } from './roles';

export const CABINET_GROUPS = [
  { label: 'My work', items: [
    { id: 'my_syllabi', label: 'My syllabi', path: '/cabinet', roles: ALL_ROLES },
    { id: 'account', label: 'Account settings', path: '/settings', roles: ALL_ROLES },
  ] },
  { label: 'Programme', items: [
    { id: 'all_syllabi', label: 'All syllabi', path: '/cabinet?view=all_syllabi', roles: PROGRAMME_ROLES },
    { id: 'plo_coverage', label: 'PLO coverage', path: '/cabinet?view=plo_coverage', roles: PROGRAMME_ROLES },
    { id: 'courses_cohorts', label: 'Courses & cohorts', path: '/cabinet?view=courses_cohorts', roles: PROGRAMME_ROLES },
  ] },
  { label: 'Library', items: [
    { id: 'policies', label: 'Course policies', path: '/cabinet?view=policies', roles: ALL_ROLES },
    { id: 'outcomes', label: 'Programme outcomes', path: '/cabinet?view=outcomes', roles: ALL_ROLES },
    { id: 'assessment', label: 'Assessment components', path: '/cabinet?view=assessment', roles: ALL_ROLES },
  ] },
  { label: 'Administration', items: [
    { id: 'users', label: 'Users', path: '/cabinet?view=users', roles: ['admin'] },
    { id: 'programs', label: 'Programmes', path: '/cabinet?view=programs', roles: ['admin'] },
  ] },
];
export const cabinetGroupsFor = (role) => CABINET_GROUPS.map(group => ({ ...group, items: group.items.filter(item => item.roles.includes(role)) })).filter(group => group.items.length);
export const cabinetViewFor = (role, requested) => cabinetGroupsFor(role).flatMap(group => group.items).some(item => item.id === requested && item.id !== 'account') ? requested : 'my_syllabi';
