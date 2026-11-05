// Єдина канонічна форма коду ПРН (PLO) для запису, перевірок, матриці, парсера, мапінгу й редактора довідників.
// Чиста функція без БД: її імпортують і чисті перевірки (services/checks), і сервіси з моделями.
//   «ПРН 3», «ПРН-3», «прн3», «PRN 3», «ПPН3» (латинські P/H серед кирилиці) → «ПРН3»;
//   коди без кирилиці лишаються латинськими: «PLO-1» → «PLO1» (латиниця не підміняється кирилицею).

// Латинські двійники кириличних великих літер — лише для кодів, де вже є кирилиця
const LOOKALIKES = { A: 'А', B: 'В', C: 'С', E: 'Е', H: 'Н', K: 'К', M: 'М', O: 'О', P: 'Р', T: 'Т', X: 'Х' };
const SEPARATORS = /[\s._\-–—/]/g;
const CYRILLIC = /[Ѐ-ӿ]/;

function canonicalPloCode(code) {
  let s = String(code ?? '').normalize('NFC').toUpperCase().replace(SEPARATORS, '');
  if (/^PRN/.test(s)) s = `ПРН${s.slice(3)}`;
  if (CYRILLIC.test(s)) s = s.replace(/[ABCEHKMOPTX]/g, (c) => LOOKALIKES[c]);
  return s;
}

module.exports = { canonicalPloCode };
