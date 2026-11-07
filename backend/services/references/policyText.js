// Текст довідника політик мовою документа (B-1.4): українська версія блоку чи варіанта, якщо вона є,
// інакше англійська. Чисті функції — для стану, рендеру, .docx і чату.
const isUk = (language) => language === 'uk';
const pick = (en, uk, language) => (isUk(language) && typeof uk === 'string' && uk.trim() ? uk : en);

const blockTitle = (block, language) => pick(block?.title, block?.titleUk, language);
/**
 * Текст locked-блоку мовою документа. Блок із параметром програми (B07: param 'passingScore', paramDefault 60)
 * отримує значення програми (refs.passingScore) замість значення школи — у кожному місці тексту.
 */
function lockedText(block, language, refs) {
  const text = pick(block?.text ?? null, block?.textUk, language);
  const value = block?.param ? refs?.[block.param] : null;
  if (text == null || !Number.isFinite(value) || value === block.paramDefault) return text;
  return text.replace(new RegExp(`(?<![\\d.,])${block.paramDefault}(?![\\d.,])`, 'g'), String(value));
}
const optionText = (option, language) => pick(option?.text ?? null, option?.textUk, language);
const optionLabel = (option, language) => pick(option?.label, option?.labelUk, language);

module.exports = { blockTitle, lockedText, optionText, optionLabel };
