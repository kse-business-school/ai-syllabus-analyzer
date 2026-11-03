// Ролі кабінету (ТЗ, доповнення 29.10 §4); має збігатися з backend/services/roles.js
export const ROLE_LABELS = {
  instructor: 'Instructor',
  manager: 'Manager',
  director: 'Academic director',
  admin: 'Administrator',
};

// Бачать усі силабуси набору й призначення курсів
export const PROGRAMME_ROLES = ['manager', 'director', 'admin'];

export const ALL_ROLES = ['instructor', 'manager', 'director', 'admin'];

export const canSeeAll = (role) => PROGRAMME_ROLES.includes(role);
