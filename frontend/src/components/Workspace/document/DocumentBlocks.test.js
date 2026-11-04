import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import DocumentBlocks from './DocumentBlocks';

global.IS_REACT_ACT_ENVIRONMENT = true;
let root;
let host;
const row = (text, parts) => ({ kind: 'table-row', text, ...(parts ? { parts } : {}) });
const render = async (props) => {
  await act(async () => root.render(<DocumentBlocks {...props} />));
};
beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

test('summary tables keep the first key/value row as data', async () => {
  await render({ sectionKey: 'at_a_glance', blocks: [row('Program | MBA28'), row('Credits (ECTS) | 3')] });
  expect(host.querySelector('thead')).toBeNull();
  expect(host.querySelectorAll('tbody tr')).toHaveLength(2);
  expect(host.querySelector('tbody tr').textContent).toBe('ProgramMBA28');
});

test('assessment uses server total once and does not sum percentages in criteria', async () => {
  await render({ sectionKey: 'assessment', blocks: [
    row('Project | 60% | Week 3 | At least 80% attendance'),
    row('Exam | 40% | Week 4 | At least 50% on the quiz'),
    row('Total | 100%'),
  ] });
  expect(host.querySelector('thead').textContent).toContain('Weight');
  expect(host.querySelectorAll('tbody tr')).toHaveLength(3);
  expect(host.querySelector('tbody tr').textContent).toContain('Project');
  expect(host.textContent.match(/Total/g)).toHaveLength(1);
  expect(host.textContent).toContain('100%');
  expect(host.textContent).not.toContain('Recommended:');
  expect(host.querySelector('tbody tr:last-child td:last-child').colSpan).toBe(3);
});

test('schedule retains the first session and separates individual work headings', async () => {
  await render({ sectionKey: 'schedule', blocks: [row('1 | Introduction | Lecture | 2 h | Online | Monday | —'),
    { kind: 'heading', text: 'Individual work' }, row('Case study | 4 h')] });
  const tables = host.querySelectorAll('table');
  expect(tables).toHaveLength(2);
  expect(tables[0].querySelector('tbody tr').textContent).toContain('Introduction');
  expect(tables[0].querySelectorAll('thead th')).toHaveLength(7);
  expect(tables[1].querySelectorAll('thead th')).toHaveLength(2);
  expect(tables[1].querySelector('tbody tr').textContent).toBe('Case study4 h');
});

test('Changes displays a row diff once with the deleted and inserted content', async () => {
  await render({ diff: true, sectionKey: 'assessment', blocks: [row('Project | 60%', [
    { type: 'eq', text: 'Project | ' }, { type: 'del', text: '40%' }, { type: 'ins', text: '60%' },
  ])] });
  expect(host.textContent.match(/Project/g)).toHaveLength(1);
  expect(host.querySelectorAll('s')).toHaveLength(1);
  expect(host.querySelectorAll('ins')).toHaveLength(1);
  expect(host.querySelector('tbody tr td').colSpan).toBe(2);
});
