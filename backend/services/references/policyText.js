// Текст довідника політик мовою документа (B-1.4): українська версія блоку чи варіанта, якщо вона є,
// інакше англійська. Чисті функції — для стану, рендеру, .docx і чату.
const isUk = (language) => language === 'uk';
const pick = (en, uk, language) => (isUk(language) && typeof uk === 'string' && uk.trim() ? uk : en);

const blockTitle = (block, language) => pick(block?.title, block?.titleUk, language);
const lockedText = (block, language) => pick(block?.text ?? null, block?.textUk, language);
const optionText = (option, language) => pick(option?.text ?? null, option?.textUk, language);
const optionLabel = (option, language) => pick(option?.label, option?.labelUk, language);

module.exports = { blockTitle, lockedText, optionText, optionLabel };
