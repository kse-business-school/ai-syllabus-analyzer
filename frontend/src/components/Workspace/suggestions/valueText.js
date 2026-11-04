// Читабельне подання всього значення слота без службових id та провенансу.
// Додаткові поля (criteria, email, officeHours, PLO) також видимі перед Confirm.
const INTERNAL = new Set(['id', '_id', 'source', 'evidenceBlockIds', 'basisHash']);
const MAIN_KEYS = ['text', 'name', 'title', 'citation', 'topic', 'label'];
const label = (key) => key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
export default function valueText(value) {
  if (value == null) return '';
  if (typeof value !== 'object') return String(value);
  if (Array.isArray(value)) return value.map(valueText).filter(Boolean).join('\n');
  const main = MAIN_KEYS.find((key) => typeof value[key] === 'string' && value[key].trim());
  return Object.entries(value)
    .filter(([key, item]) => !INTERNAL.has(key) && item != null && item !== '')
    .map(([key, item]) => key === 'photo' ? 'Photo: Included' : key === main ? valueText(item) : `${label(key)}: ${valueText(item)}`)
    .join('\n');
}
