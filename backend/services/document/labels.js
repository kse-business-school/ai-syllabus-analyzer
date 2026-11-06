// Підписи документа мовою силабуса (B-1.3, B-8.9): живий документ (syllabusState/render) і .docx
// (writers/templateDocx). Назви розділів беруться з TemplateSection (title / titleUk), тут — підписи полів і таблиць.
const LABELS = {
  en: {
    program: 'Program', programBlock: 'Programme block', courseType: 'Course type', term: 'Term', deliveryMode: 'Delivery mode',
    credits: 'Credits (ECTS)', totalHours: 'Total hours', contactHours: 'Contact hours', selfStudyHours: 'Self-study hours',
    department: 'Department', language: 'Language', studyMode: 'Study mode', instructor: 'Instructor',
    courseTitle: 'Course Title', courseCode: 'Course Code', prerequisites: 'Prerequisites',
    core: 'Core', elective: 'Elective', partial: 'partial',
    email: 'Email', officeHours: 'Office hours', assistants: 'Assistants', expertise: 'Areas of Expertise', education: 'Education', experience: 'Professional Experience',
    session: 'Session', module: 'Module', topic: 'Topic', format: 'Content and format', prep: 'Preparation', deadline: 'Deadline', guest: 'Guest',
    individualWork: 'Individual work', total: 'Total', compensation: 'Compensation and retakes', points: 'points',
    component: 'Component', weight: 'Weight', criteria: 'Performance Criteria', rubric: 'Rubric',
    required: 'Required', recommended: 'Recommended', bySession: 'Materials for sessions', before: (n) => `Before session ${n}`,
    guestName: 'Guest / company', guestTopic: 'Topic / format', guestStatus: 'Status',
    status: { confirmed: 'Confirmed', in_progress: 'In progress', tbd: 'Not decided' },
    ploIntro: 'This course contributes to the following programme learning outcomes:', ploColumn: 'Programme outcome', ploHow: 'Course outcomes',
    loIntro: 'By the end of this course, you will be able to:',
  },
  uk: {
    program: 'Програма', programBlock: 'Корпус і блок програми', courseType: 'Тип курсу', term: 'Терміни', deliveryMode: 'Формат',
    credits: 'Кількість кредитів (ЄКТС)', totalHours: 'Усього годин', contactHours: 'Аудиторні години', selfStudyHours: 'Самостійна робота, год',
    department: 'Кафедра', language: 'Мова викладання', studyMode: 'Форма навчання', instructor: 'Лектор(и)',
    courseTitle: 'Назва курсу', courseCode: 'Код курсу', prerequisites: 'Передумови',
    core: 'Обов\'язковий', elective: 'Елективний', partial: 'частково',
    email: 'Email', officeHours: 'Консультації', assistants: 'Асистенти', expertise: 'Сфери експертизи', education: 'Освіта', experience: 'Професійний досвід',
    session: 'Сесія', module: 'Модуль', topic: 'Тема', format: 'Зміст і формат', prep: 'Підготовка до заняття', deadline: 'Дедлайн', guest: 'Гість',
    individualWork: 'Самостійна робота', total: 'Разом', compensation: 'Компенсація та перескладання', points: 'балів',
    component: 'Компонент', weight: 'Вага', criteria: 'Критерії оцінювання', rubric: 'Рубрика',
    required: 'Обов\'язкові матеріали курсу', recommended: 'Рекомендовані матеріали', bySession: 'Матеріали до занять (по сесіях)', before: (n) => `Перед сесією ${n}`,
    guestName: 'Гість / компанія', guestTopic: 'Тема / формат', guestStatus: 'Статус',
    status: { confirmed: 'Підтверджено', in_progress: 'У процесі', tbd: 'Не визначено' },
    ploIntro: 'Курс підсилює такі результати навчання програми:', ploColumn: 'Результат програми', ploHow: 'Результати навчання курсу',
    loIntro: 'Після завершення курсу учасник зможе:',
  },
};

const labelsFor = (language) => (language === 'uk' ? LABELS.uk : LABELS.en);
const sectionTitleOf = (t, language) => (language === 'uk' && t?.titleUk ? t.titleUk : t?.title || '');
const docTitleOf = (t, language) => (language === 'uk' && t?.docTitleUk ? t.docTitleUk : t?.docTitle || '');

/** Сесії з номерами для документа: у модулях — 1.1, 1.2 … (B-6.2), без модулів — 1, 2 … */
function sessionNumbers(state) {
  const modules = [...(state.modules || [])].sort((a, b) => (a.n ?? 0) - (b.n ?? 0));
  const index = new Map(modules.map((m, i) => [m.id, i + 1]));
  const perModule = new Map();
  return (state.sessions || []).map((x, i) => {
    const m = x.moduleId && index.get(x.moduleId);
    if (!m) return { session: x, label: String(x.n ?? i + 1) };
    const k = (perModule.get(m) || 0) + 1;
    perModule.set(m, k);
    return { session: x, label: `${m}.${k}`, module: m };
  });
}

module.exports = { LABELS, labelsFor, sectionTitleOf, docTitleOf, sessionNumbers };
