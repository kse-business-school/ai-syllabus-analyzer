// Читабельне подання всього значення слота без службових id та провенансу.
// Додаткові поля (criteria, email, officeHours, PLO) також видимі перед Confirm.
// Порожні масиви й об'єкти, службові прапорці й списки id не показуються (B-10.4: «Plo:», «Assessment Ids:»).
const INTERNAL = new Set(['id', '_id', 'source', 'evidenceBlockIds', 'basisHash', 'criteriaKeys', 'confirmed']);
const MAIN_KEYS = ['text', 'name', 'title', 'citation', 'topic', 'label'];
const LABELS = { plo: 'PLO' };
const label = (key) => LABELS[key] || key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
const isInternal = (key) => INTERNAL.has(key) || /Ids$/.test(key);

/** Зв'язок CLO → PLO: «ПРН1 (full)». */
const ploText = (link) => (link && typeof link === 'object' && typeof link.code === 'string'
  ? `${link.code}${link.coverage ? ` (${link.coverage})` : ''}` : null);

export default function valueText(value) {
  if (value == null) return '';
  if (typeof value !== 'object') return String(value);
  if (Array.isArray(value)) return value.map(valueText).filter(Boolean).join('\n');
  const main = MAIN_KEYS.find((key) => typeof value[key] === 'string' && value[key].trim());
  return Object.entries(value)
    .filter(([key, item]) => !isInternal(key) && item != null && item !== '' && item !== false)
    .map(([key, item]) => {
      if (key === 'photo') return 'Photo: Included';
      if (key === main) return valueText(item);
      const text = key === 'plo' && Array.isArray(item) ? item.map(ploText).filter(Boolean).join(', ') : valueText(item);
      return text ? `${label(key)}: ${text}` : '';
    })
    .filter(Boolean)
    .join('\n');
}
