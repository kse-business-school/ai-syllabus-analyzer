// Спільні фікстури тестів парсера: синтетичний docx (test/fixtures/docx/parse-syllabus.docx), витяг моделі за його блоками, довідники.
const fs = require('fs');
const path = require('path');
const { loadFixtureRefs } = require('../../services/references/fixtureRefs');

const DOCX = path.join(__dirname, '..', 'fixtures', 'docx', 'parse-syllabus.docx');
const refs = (programCode = 'MBA28') => loadFixtureRefs(programCode);

let cached;
async function loadBlocks() {
  if (!cached) {
    const { loadDocument } = require('../../services/document');
    cached = (await loadDocument(fs.readFileSync(DOCX), 'docx', {})).doc.blocks;
  }
  return cached;
}

const textItem = (text, blockIds) => ({ text, blockIds });
const nullItem = () => ({ text: null, blockIds: [] });

// Відповідь моделі для parse-syllabus.docx (id блоків: див. generateParse.js)
// Поля MMM (B-8.8) у відповіді моделі для MBA-файлу — порожні
const MMM_EMPTY = { practicalApplication: { text: null, blockIds: [] }, programmeOutcomes: [], modules: [], guests: [] };
const sessionExtra = { moduleId: '', prep: '', deadline: '' };
const assessmentExtra = { maxPoints: null, unitCount: null, rubric: [] };

function slots(overrides = {}) {
  const base = baseSlots();
  base.header.programBlock = '';
  base.sessions = base.sessions.map((x) => ({ ...x, ...sessionExtra }));
  base.assessments = base.assessments.map((x) => ({ ...x, ...assessmentExtra }));
  base.materials.bySession = [];
  return { ...base, ...MMM_EMPTY, ...overrides };
}

function baseSlots() {
  return {
    header: {
      title: 'Negotiation and Influence', code: null, department: null, ects: null, totalHours: null, language: null, studyMode: null,
      deliveryFormat: 'online', termText: null, termStart: null, termEnd: null, blockIds: ['b0003', 'b0025'],
    },
    declared: { assessmentTotal: null, contactHours: null, selfStudyHours: null, deliveryMode: null, term: null, instructor: null, blockIds: [] },
    prerequisites: textItem('none', ['b0004']),
    shortDescription: textItem('Negotiation is part of every manager’s week. This course gives you a practical toolkit for preparing, running and reviewing negotiations with clients, partners and teams.', ['b0005']),
    objectives: [{ text: 'The course helps you to understand negotiation.', blockIds: ['b0006'] }],
    outcomes: [
      { id: 'clo1', text: 'Apply a preparation framework to a real negotiation', ploCodes: [], blockIds: ['b0008'] },
      { id: 'clo2', text: 'Be familiar with influence tactics', ploCodes: [], blockIds: ['b0009'] },
    ],
    capstone: textItem('The course helps you to negotiate resources and scope for your capstone project with its stakeholders.', ['b0010']),
    instructors: [{
      name: 'Jane Doe', position: 'Associate professor of management', email: 'jane.doe@example.org', officeHours: null,
      expertise: ['Negotiation', 'Organisational behaviour'], education: [], experience: [], blockIds: ['b0012', 'b0013', 'b0014', 'b0016', 'b0017'],
    }],
    sessions: [
      { topic: 'Preparing a negotiation', type: null, hours: 4, format: 'online', guest: null, additional: 'Required reading: Getting to Yes, ch. 1', date: 'March 7, 2026', time: '9.30 – 12.20', blockIds: ['b0023', 'b0024', 'b0025', 'b0026'] },
      { topic: 'Influence and persuasion', type: null, hours: 4, format: 'online', guest: null, additional: null, date: 'March 8, 2026', time: '9.30 – 12.20', blockIds: ['b0027', 'b0028', 'b0029'] },
      { topic: 'Negotiation simulation', type: null, hours: 2, format: 'online', guest: null, additional: null, date: 'March 14, 2026', time: '9.30 – 11.10', blockIds: ['b0031', 'b0032', 'b0033'] },
    ],
    individualWork: [
      { title: 'Reading of the mandatory materials', hours: 3, blockIds: ['b0036'] },
      { title: 'Preparation for the final negotiation', hours: 5, blockIds: ['b0037'] },
    ],
    assessments: [
      { id: 'as1', name: 'Class participation', weight: 20, criteria: 'Active contribution to discussions and simulations.', deadline: 'Throughout the course', isParticipation: true, isControl: false, outcomeIds: [], blockIds: ['b0043', 'b0044', 'b0045', 'b0046'] },
      { id: 'as2', name: 'Negotiation simulation', weight: 30, criteria: 'Quality of preparation and of the agreement reached.', deadline: '14.03.26', isParticipation: false, isControl: true, outcomeIds: ['clo1'], blockIds: ['b0047', 'b0048', 'b0049', 'b0050'] },
      { id: 'as3', name: 'Final negotiation plan', weight: 50, criteria: 'A negotiation plan for a real case, with a BATNA analysis.', deadline: '28.03.26', isParticipation: false, isControl: true, outcomeIds: ['clo1', 'clo2'], blockIds: ['b0051', 'b0052', 'b0053', 'b0054'] },
    ],
    materials: {
      required: [{ citation: 'Fisher R., Ury W. Getting to Yes. Penguin, 2011.', url: null, blockIds: ['b0057'] }],
      recommended: [{ citation: 'Cialdini R. Influence: The Psychology of Persuasion. Harper Business, 2021.', url: null, blockIds: ['b0059'] }],
    },
    policySegments: [
      { text: 'Attendance is mandatory. If a student misses more than 40% of classes, they will be required to retake the course unless explicitly agreed otherwise with the instructor.', blockIds: ['b0061'], topicHint: 'attendance' },
      { text: 'Work submitted late is accepted until the next class, with a lower maximum score.', blockIds: ['b0062'], topicHint: 'late submissions' },
      { text: 'To pass the course a student must earn at least 60 points out of 100.', blockIds: ['b0063'], topicHint: 'passing score' },
    ],
  };
}

// Класифікація сегментів: 0 — відвідування (equivalent, attendance_std), 1 — запізнення (none: варіанта немає), 2 — прохідний бал (locked)
const classifications = () => ({
  classifications: [
    { segmentIndex: 0, blockKey: 'policy.attendance', optionKey: 'attendance_std', match: 'equivalent' },
    { segmentIndex: 1, blockKey: 'policy.late', optionKey: null, match: 'none' },
    { segmentIndex: 2, blockKey: 'policy.passing', optionKey: null, match: 'equivalent' },
  ],
});

const reply = (obj) => ({ status: 'completed', output_text: JSON.stringify(obj) });

module.exports = { DOCX, refs, loadBlocks, slots, classifications, reply, textItem, nullItem };
