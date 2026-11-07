// Результати навчання курсу (CLO): кожен має перевірятися хоча б одним компонентом оцінювання.
const { tr, pluralUk, makeCheck, filled } = require('./common');

function run(state) {
  const assessed = new Set((state.assessments || []).flatMap((a) => a.outcomeIds || []));
  return (state.outcomes || []).flatMap((o, i) => {
    if (!filled(o.text) || (o.assessmentIds || []).length || assessed.has(o.id)) return [];
    return [makeCheck({
      rule: 'outcomes.clo_unassessed', entityId: o.id, severity: 'warning', section: 'learning_outcomes', path: 'outcomes[].assessmentIds',
      message: tr(state, `Learning outcome ${i + 1} ("${o.text}") is not linked to any assessment component. Which component checks it?`,
        `Результат навчання ${i + 1} («${o.text}») не пов'язаний із жодним компонентом оцінювання. Який компонент його перевіряє?`),
      details: { outcomeIndex: i + 1 },
    })];
  });
}

module.exports = { run };
