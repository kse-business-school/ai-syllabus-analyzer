// Ролі й права кабінету (ТЗ, доповнення 29.10 §4): один набір екранів, роль дає права на ті самі екрани.
const ROLES = ['instructor', 'manager', 'director', 'admin'];

// Бачать усі силабуси набору (лише читання; мутації в чаті — тільки власник)
const SEE_ALL_ROLES = ['manager', 'director', 'admin'];

// Призначають курси до наборів і редагують довідники (course policies, programme outcomes)
const PROGRAMME_ROLES = ['manager', 'director', 'admin'];

const canSeeAll = (role) => SEE_ALL_ROLES.includes(role);
const canManageProgramme = (role) => PROGRAMME_ROLES.includes(role);

module.exports = { ROLES, SEE_ALL_ROLES, PROGRAMME_ROLES, canSeeAll, canManageProgramme };
