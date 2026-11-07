import React, { useEffect, useState } from 'react';
import {
  Alert, Box, Button, CircularProgress, IconButton, Stack, TextField, Tooltip, Typography,
} from '@mui/material';
import Add from '@mui/icons-material/Add';
import ArrowDownward from '@mui/icons-material/ArrowDownward';
import ArrowUpward from '@mui/icons-material/ArrowUpward';
import Close from '@mui/icons-material/Close';
import api from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import { canSeeAll } from '../../utils/roles';

// Довідники набору в Library: ПРН (outcomes), нормативні курси (courses), Capstone (capstone).
// Перегляд — усім; редагування — manager / director / admin. Збереження замінює весь перелік набору;
// після нього сід з фікстур цей довідник уже не перезаписує (backend/services/references/editor.js).

const pct = (w) => (w == null || w === '' ? '' : String(Math.round(Number(w) * 1000) / 10));
const frac = (p) => (p === '' || p == null ? NaN : Number(String(p).replace(',', '.')) / 100);

const COPY = {
  outcomes: {
    intro: 'Programme learning outcomes (PLO) of the cohort, in the wording approved in the educational programme. Course outcomes in every syllabus of this cohort are mapped to them.',
    empty: 'No programme outcomes are recorded for this cohort yet. Without them, the PLO check and the PLO coverage matrix have nothing to compare with.',
    blank: () => ({ code: '', text: '', label: '' }),
  },
  courses: {
    intro: 'Core (mandatory) courses of the cohort. Any course that is not listed here counts as an elective, unless a course assignment says otherwise.',
    empty: 'No core courses are recorded for this cohort yet, so every course is treated as an elective.',
    blank: () => ({ code: '', uk: '', en: '', ects: '' }),
  },
};

/** Рядки з кнопками «вгору / вниз / прибрати». */
const RowControls = ({ index, count, onMove, onRemove, label }) => (
  <Stack direction="row" sx={{ flexShrink: 0 }}>
    <Tooltip title="Move up"><span><IconButton size="small" aria-label={`Move ${label} up`} disabled={index === 0} onClick={() => onMove(index, -1)}><ArrowUpward fontSize="small" /></IconButton></span></Tooltip>
    <Tooltip title="Move down"><span><IconButton size="small" aria-label={`Move ${label} down`} disabled={index === count - 1} onClick={() => onMove(index, 1)}><ArrowDownward fontSize="small" /></IconButton></span></Tooltip>
    <Tooltip title="Remove"><IconButton size="small" aria-label={`Remove ${label}`} onClick={() => onRemove(index)}><Close fontSize="small" /></IconButton></Tooltip>
  </Stack>
);

function useRows(initial) {
  const [rows, setRows] = useState(initial);
  return {
    rows,
    setRows,
    set: (i, patch) => setRows((list) => list.map((r, j) => (j === i ? { ...r, ...patch } : r))),
    add: (row) => setRows((list) => [...list, row]),
    remove: (i) => setRows((list) => list.filter((_, j) => j !== i)),
    move: (i, d) => setRows((list) => {
      const next = [...list];
      [next[i], next[i + d]] = [next[i + d], next[i]];
      return next;
    }),
  };
}

const CohortReferencesTab = ({ programCode, kind }) => {
  const { user } = useAuth();
  const editable = canSeeAll(user?.role);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const list = useRows([]);
  const types = useRows([]);
  const parts = useRows([]);

  useEffect(() => {
    let active = true;
    setLoading(true); setError(''); setNotice(''); setEditing(false); setData(null);
    if (!programCode) { setLoading(false); return undefined; }
    const load = kind === 'outcomes' ? api.references.outcomes : kind === 'courses' ? api.references.courses : api.references.capstone;
    load(programCode)
      .then(({ data: d }) => { if (active) setData(d); })
      .catch((err) => {
        if (!active) return;
        // Capstone ще не заведено для набору — порожній довідник, а не помилка
        if (kind === 'capstone' && err.response?.status === 404) setData(null);
        else setError('Could not load this reference. Please try again.');
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [programCode, kind]);

  const startEdit = () => {
    setError(''); setNotice('');
    if (kind === 'outcomes') list.setRows((data || []).map((o) => ({ code: o.code, text: o.text || '', label: o.label || '', themeDraft: o.themeDraft || '' })));
    else if (kind === 'courses') list.setRows((data || []).map((c) => ({ code: c.code, uk: c.uk || '', en: c.en || '', ects: c.ects ?? '' })));
    else {
      list.setRows((data?.criteria || []).map((c) => ({ key: c.key, name: c.name || '', weight: pct(c.weight), description: c.description || '' })));
      types.setRows((data?.projectTypes || []).map((t) => ({ key: t.key, label: t.label || '' })));
      parts.setRows((data?.structure || []).map((s) => ({ text: s })));
    }
    setEditing(true);
  };

  const save = async () => {
    setBusy(true); setError('');
    try {
      let saved;
      if (kind === 'outcomes') {
        saved = (await api.references.saveOutcomes(programCode, list.rows)).data;
      } else if (kind === 'courses') {
        const res = (await api.references.saveCourses(programCode, list.rows.map((c) => ({ ...c, ects: c.ects === '' ? null : c.ects })))).data;
        saved = res.courses;
        if (res.resynced) setNotice(`Course type was updated in ${res.resynced} syllabi of ${programCode}.`);
      } else {
        saved = (await api.references.saveCapstone(programCode, {
          criteria: list.rows.map((c) => ({ key: c.key, name: c.name, description: c.description, weight: frac(c.weight) })),
          projectTypes: types.rows.map((t) => ({ key: t.key, label: t.label })),
          structure: parts.rows.map((p) => p.text),
        })).data;
      }
      setData(saved);
      setEditing(false);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not save the changes.');
    } finally {
      setBusy(false);
    }
  };

  if (!programCode) return <Typography color="text.secondary">Select a cohort to view its references.</Typography>;
  if (loading) return <Box sx={{ py: 5, textAlign: 'center' }}><CircularProgress size={26} /></Box>;

  const header = (
    <Stack direction="row" alignItems="flex-start" spacing={2} sx={{ mb: 2.5 }}>
      <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
        {kind === 'capstone'
          ? 'The Capstone guide of the cohort: project types, report structure and the assessment criteria that course syllabi refer to in Connection to Capstone.'
          : COPY[kind].intro}
      </Typography>
      {editable && !editing && <Button variant="outlined" size="small" onClick={startEdit}>Edit</Button>}
    </Stack>
  );
  const footer = editing && (
    <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ mt: 2.5 }}>
      <Button onClick={() => { setEditing(false); setError(''); }} disabled={busy}>Cancel</Button>
      <Button variant="contained" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</Button>
    </Stack>
  );
  const alerts = <>
    {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
    {notice && <Alert severity="info" sx={{ mb: 2 }} onClose={() => setNotice('')}>{notice}</Alert>}
  </>;

  // ---------- ПРН ----------
  if (kind === 'outcomes') {
    return <Box>
      {header}{alerts}
      {editing ? <>
        <Alert severity="warning" sx={{ mb: 2 }}>Use the wording approved in the educational programme (in Ukrainian). The English label is a short name for the PLO matrix. An outcome that syllabi already link to cannot be removed.</Alert>
        <Stack spacing={1.5}>
          {list.rows.map((o, i) => <Stack key={i} direction={{ xs: 'column', md: 'row' }} spacing={1} alignItems={{ md: 'flex-start' }} sx={{ pb: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
            <TextField label="Code" size="small" value={o.code} onChange={(e) => list.set(i, { code: e.target.value })} sx={{ width: { md: 110 } }} placeholder="ПРН1" />
            <TextField label="Official wording" size="small" value={o.text} onChange={(e) => list.set(i, { text: e.target.value })} multiline minRows={2} sx={{ flex: 2 }} inputProps={{ lang: 'uk' }} />
            <TextField label="English label" size="small" value={o.label} onChange={(e) => list.set(i, { label: e.target.value })} sx={{ flex: 1 }} inputProps={{ maxLength: 120 }} />
            <RowControls index={i} count={list.rows.length} onMove={list.move} onRemove={list.remove} label={o.code || `outcome ${i + 1}`} />
          </Stack>)}
          <Box><Button size="small" startIcon={<Add />} onClick={() => list.add({ ...COPY.outcomes.blank(), code: `ПРН${list.rows.length + 1}` })}>Add outcome</Button></Box>
        </Stack>
        {footer}
      </> : !(data || []).length ? <Typography color="text.secondary">{COPY.outcomes.empty}</Typography>
        : data.map((o) => <Box key={o.code} sx={{ py: 2.5, borderTop: '1px solid', borderColor: 'divider' }}>
          <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 1 }}><Box component="span" className="brand-plate">{o.code.replace('ПРН', 'PLO')}</Box><Typography sx={{ fontSize: 14, fontWeight: 700 }}>{o.label || o.themeDraft || o.code}</Typography></Stack>
          <Typography variant="body2" color="text.secondary" lang="uk">{o.text}</Typography>
        </Box>)}
    </Box>;
  }

  // ---------- Нормативні курси ----------
  if (kind === 'courses') {
    return <Box>
      {header}{alerts}
      {editing ? <>
        <Stack spacing={1.5}>
          {list.rows.map((c, i) => <Stack key={i} direction={{ xs: 'column', md: 'row' }} spacing={1} alignItems={{ md: 'center' }}>
            <TextField label="Code" size="small" value={c.code} onChange={(e) => list.set(i, { code: e.target.value })} sx={{ width: { md: 110 } }} placeholder="НД.1" />
            <TextField label="Official title (Ukrainian)" size="small" value={c.uk} onChange={(e) => list.set(i, { uk: e.target.value })} sx={{ flex: 1 }} inputProps={{ lang: 'uk' }} />
            <TextField label="English title" size="small" value={c.en} onChange={(e) => list.set(i, { en: e.target.value })} sx={{ flex: 1 }} />
            <TextField label="ECTS" size="small" value={c.ects} onChange={(e) => list.set(i, { ects: e.target.value })} sx={{ width: { md: 80 } }} inputProps={{ inputMode: 'decimal' }} />
            <RowControls index={i} count={list.rows.length} onMove={list.move} onRemove={list.remove} label={c.code || `course ${i + 1}`} />
          </Stack>)}
          <Box><Button size="small" startIcon={<Add />} onClick={() => list.add(COPY.courses.blank())}>Add course</Button></Box>
        </Stack>
        {footer}
      </> : !(data || []).length ? <Typography color="text.secondary">{COPY.courses.empty}</Typography>
        : data.map((c) => <Stack key={c.code} direction="row" spacing={2} sx={{ py: 1.5, borderTop: '1px solid', borderColor: 'divider' }}>
          <Typography sx={{ width: 90, fontWeight: 700, fontSize: 13 }}>{c.code}</Typography>
          <Box sx={{ flex: 1 }}><Typography sx={{ fontSize: 14 }}>{c.en || c.uk}</Typography>{c.en && <Typography variant="caption" color="text.secondary" lang="uk">{c.uk}</Typography>}</Box>
          <Typography variant="body2" color="text.secondary">{c.ects != null ? `${c.ects} ECTS` : '—'}</Typography>
        </Stack>)}
    </Box>;
  }

  // ---------- Capstone ----------
  const total = list.rows.reduce((sum, c) => sum + (Number(String(c.weight).replace(',', '.')) || 0), 0);
  return <Box>
    {header}{alerts}
    {editing ? <>
      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Assessment criteria</Typography>
      <Stack spacing={1.5}>
        {list.rows.map((c, i) => <Stack key={i} direction={{ xs: 'column', md: 'row' }} spacing={1} alignItems={{ md: 'flex-start' }}>
          <TextField label="Criterion" size="small" value={c.name} onChange={(e) => list.set(i, { name: e.target.value })} sx={{ flex: 1 }} />
          <TextField label="Weight, %" size="small" value={c.weight} onChange={(e) => list.set(i, { weight: e.target.value })} sx={{ width: { md: 100 } }} inputProps={{ inputMode: 'decimal' }} />
          <TextField label="Description" size="small" value={c.description} onChange={(e) => list.set(i, { description: e.target.value })} multiline minRows={2} sx={{ flex: 2 }} />
          <RowControls index={i} count={list.rows.length} onMove={list.move} onRemove={list.remove} label={c.name || `criterion ${i + 1}`} />
        </Stack>)}
        <Stack direction="row" alignItems="center" spacing={2}>
          <Button size="small" startIcon={<Add />} onClick={() => list.add({ key: '', name: '', weight: '', description: '' })}>Add criterion</Button>
          <Typography variant="caption" color={Math.abs(total - 100) < 0.05 ? 'text.secondary' : 'error'}>Total: {Math.round(total * 10) / 10}% (must be 100%)</Typography>
        </Stack>
      </Stack>
      <Typography variant="subtitle2" sx={{ fontWeight: 700, mt: 3, mb: 1 }}>Project types</Typography>
      <Stack spacing={1}>
        {types.rows.map((t, i) => <Stack key={i} direction="row" spacing={1} alignItems="center">
          <TextField label="Project type" size="small" value={t.label} onChange={(e) => types.set(i, { label: e.target.value })} sx={{ flex: 1 }} />
          <RowControls index={i} count={types.rows.length} onMove={types.move} onRemove={types.remove} label={t.label || `project type ${i + 1}`} />
        </Stack>)}
        <Box><Button size="small" startIcon={<Add />} onClick={() => types.add({ key: '', label: '' })}>Add project type</Button></Box>
      </Stack>
      <Typography variant="subtitle2" sx={{ fontWeight: 700, mt: 3, mb: 1 }}>Report structure</Typography>
      <Stack spacing={1}>
        {parts.rows.map((p, i) => <Stack key={i} direction="row" spacing={1} alignItems="center">
          <TextField label={`Part ${i + 1}`} size="small" value={p.text} onChange={(e) => parts.set(i, { text: e.target.value })} sx={{ flex: 1 }} />
          <RowControls index={i} count={parts.rows.length} onMove={parts.move} onRemove={parts.remove} label={p.text || `part ${i + 1}`} />
        </Stack>)}
        <Box><Button size="small" startIcon={<Add />} onClick={() => parts.add({ text: '' })}>Add part</Button></Box>
      </Stack>
      {footer}
    </> : !data || !(data.criteria || []).length ? <Typography color="text.secondary">No Capstone guide is recorded for this cohort yet, so syllabi cannot refer to Capstone criteria.</Typography> : <>
      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Assessment criteria</Typography>
      {data.criteria.map((c) => <Box key={c.key} sx={{ py: 1.5, borderTop: '1px solid', borderColor: 'divider' }}>
        <Stack direction="row" spacing={2}><Typography sx={{ flex: 1, fontWeight: 700, fontSize: 14 }}>{c.name}</Typography><Typography variant="body2" color="text.secondary">{pct(c.weight)}%</Typography></Stack>
        {c.description && <Typography variant="body2" color="text.secondary">{c.description}</Typography>}
      </Box>)}
      {(data.projectTypes || []).length > 0 && <><Typography variant="subtitle2" sx={{ fontWeight: 700, mt: 3, mb: 1 }}>Project types</Typography>{data.projectTypes.map((t) => <Typography key={t.key} variant="body2">• {t.label}</Typography>)}</>}
      {(data.structure || []).length > 0 && <><Typography variant="subtitle2" sx={{ fontWeight: 700, mt: 3, mb: 1 }}>Report structure</Typography>{data.structure.map((s, i) => <Typography key={i} variant="body2">{i + 1}. {s}</Typography>)}</>}
    </>}
  </Box>;
};

export default CohortReferencesTab;
