// Назва й питання розділу шаблону мовою документа (B-1.3): titleUk / questionUk для uk, інакше англійські.
const isUk = (language) => language === 'uk';

const sectionTitle = (section, language) => (isUk(language) && section?.titleUk ? section.titleUk : section?.title || '');
const sectionQuestion = (section, language) => (isUk(language) && section?.questionUk ? section.questionUk : section?.question || null);

/** Короткі службові фрази питань (why), які сервер додає до питання за розділом. */
const WHY = {
  en: {
    narrative: 'One description is enough for me to draft the summary, objectives, learning outcomes and Capstone connection for you to confirm.',
    needsInput: (t) => `The section "${t}" still needs your input.`,
    empty: (t) => `The section "${t}" is still empty.`,
    incomplete: (t) => `The section "${t}" is not complete yet.`,
    include: (t) => `What would you like to include in ${t}?`,
  },
  uk: {
    narrative: 'Одного опису досить, щоб я підготував чернетки опису, цілей, результатів навчання і зв\'язку з Capstone вам на підтвердження.',
    needsInput: (t) => `Розділ «${t}» ще потребує вашої відповіді.`,
    empty: (t) => `Розділ «${t}» ще порожній.`,
    incomplete: (t) => `Розділ «${t}» ще не завершено.`,
    include: (t) => `Що ви хотіли б додати до розділу «${t}»?`,
  },
};
const phrases = (language) => (isUk(language) ? WHY.uk : WHY.en);

module.exports = { sectionTitle, sectionQuestion, phrases };
