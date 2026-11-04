import React, { useEffect, useState } from 'react';
import { Box, Typography, Button, CircularProgress, Alert, Accordion, AccordionSummary, AccordionDetails, Chip, Stack, TextField, Dialog, DialogTitle, DialogContent, DialogActions } from '@mui/material';
import ExpandMore from '@mui/icons-material/ExpandMore';
import api from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import { canSeeAll } from '../../utils/roles';

const ReferenceLibraryTab = ({ programCode, section = 'policies' }) => {
  const { user } = useAuth();
  const editable = canSeeAll(user?.role);
  const [policies, setPolicies] = useState([]);
  const [outcomes, setOutcomes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    setError(''); setLoading(true); setEditing(null);
    const request = section === 'policies' ? api.policies.syllabusLibrary() : section === 'outcomes' && programCode ? api.references.outcomes(programCode) : Promise.resolve({ data: [] });
    request.then(({ data }) => { if (active) { setPolicies(data.policies || []); setOutcomes(Array.isArray(data) ? data : []); } })
      .catch(() => { if (active) setError('Could not load the library. Please try again.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [section, programCode]);
  const save = async () => {
    setBusy(true); setError('');
    try {
      if (section === 'outcomes') {
        const { data } = await api.references.updateOutcomeLabel(programCode, editing.code, editing.label);
        setOutcomes(list => list.map(o => o.code === editing.code ? { ...o, label: data.label } : o));
      } else {
        const data = new FormData(); data.append('title', editing.title); data.append('rationale', editing.rationale || '');
        if (editing.mode === 'library') data.append('options', JSON.stringify(editing.options)); else data.append('text', editing.text);
        const response = await api.policies.update(editing._id, data);
        setPolicies(list => list.map(p => p._id === editing._id ? response.data.policy || editing : p));
      }
      setEditing(null);
    } catch (err) { setError(err.response?.data?.message || 'Could not save the changes.'); }
    finally { setBusy(false); }
  };
  return <Box>
    {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
    {loading ? <Box sx={{ py: 5, textAlign: 'center' }}><CircularProgress size={26} /></Box> : section === 'policies' ? <>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>Course policies used across KSE syllabi. {editable ? 'Edit wording and presets while keeping the policy structure.' : 'Choose a policy preset when working on your syllabus.'}</Typography>
      {!policies.length && <Typography color="text.secondary">No course policies have been published yet.</Typography>}
      {policies.map(policy => <Accordion key={policy._id || policy.key} disableGutters sx={{ mb: 1 }}>
        <AccordionSummary expandIcon={<ExpandMore />}><Stack direction="row" alignItems="center" spacing={1.5} sx={{ minWidth: 0 }}><Typography sx={{ fontSize: 13, fontWeight: 700 }}>{policy.title}</Typography><Chip size="small" label={policy.mode === 'locked' ? 'Fixed wording' : `${policy.options?.length || 0} presets`} /></Stack></AccordionSummary>
        <AccordionDetails><Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{policy.rationale}</Typography>
          {policy.text && <Typography variant="body2" sx={{ p: 2, bgcolor: 'background.band', mb: 1 }}>{policy.text}</Typography>}
          {policy.options?.map(option => <Box key={option.key} sx={{ py: 2, borderTop: '1px solid', borderColor: 'divider' }}><Typography sx={{ fontSize: 13, fontWeight: 700, mb: .5 }}>{option.label}</Typography><Typography variant="body2" color="text.secondary">{option.text}</Typography></Box>)}
          {editable && <Button variant="outlined" onClick={() => setEditing(structuredClone(policy))}>Edit policy</Button>}
        </AccordionDetails>
      </Accordion>)}
    </> : section === 'outcomes' ? <>
      {!programCode ? <Typography color="text.secondary">Select a cohort to view programme outcomes.</Typography> : outcomes.length === 0 ? <Typography color="text.secondary">No programme outcomes have been published for {programCode}.</Typography> : outcomes.map(outcome => <Box key={outcome.code} sx={{ py: 2.5, borderTop: '1px solid', borderColor: 'divider' }}>
        <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 1 }}><Box component="span" className="brand-plate">{outcome.code.replace('ПРН', 'PLO')}</Box><Typography sx={{ flex: 1, fontSize: 14, fontWeight: 700 }}>{outcome.label || outcome.themeDraft || outcome.code}</Typography>{editable && <Button size="small" onClick={() => setEditing({ code: outcome.code, label: outcome.label || '' })}>Edit label</Button>}</Stack>
        <Typography variant="body2" color="text.secondary" lang="uk">{outcome.text}</Typography>
      </Box>)}
    </> : <Box sx={{ border: '1px solid', borderColor: 'divider', py: 6, px: 3, textAlign: 'center' }}><Typography component="h2" sx={{ fontWeight: 700, mb: 1 }}>No assessment components published</Typography><Typography variant="body2" color="text.secondary" sx={{ maxWidth: 480, mx: 'auto' }}>The shared assessment catalogue is awaiting approved components. You can define assessment components in each syllabus.</Typography></Box>}
    <Dialog open={Boolean(editing)} onClose={() => !busy && setEditing(null)} fullWidth maxWidth="sm"><DialogTitle>{section === 'outcomes' ? 'Edit English label' : 'Edit course policy'}</DialogTitle><DialogContent><Stack spacing={2} sx={{ pt: 1 }}>
      {editing && (section === 'outcomes' ? <TextField label="English matrix label" value={editing.label} onChange={e => setEditing({ ...editing, label: e.target.value })} inputProps={{ maxLength: 120 }} helperText="The official Ukrainian wording stays unchanged." fullWidth autoFocus /> : <>
        <TextField label="Title" value={editing.title} onChange={e => setEditing({ ...editing, title: e.target.value })} fullWidth />
        <TextField label="Rationale" value={editing.rationale || ''} onChange={e => setEditing({ ...editing, rationale: e.target.value })} fullWidth multiline minRows={2} />
        {editing.mode === 'library' ? editing.options?.map((option, index) => <Box key={option.key}><TextField label="Preset name" value={option.label} onChange={e => setEditing({ ...editing, options: editing.options.map((o, i) => i === index ? { ...o, label: e.target.value } : o) })} fullWidth sx={{ mb: 1 }} /><TextField label="Preset text" value={option.text} onChange={e => setEditing({ ...editing, options: editing.options.map((o, i) => i === index ? { ...o, text: e.target.value } : o) })} fullWidth multiline minRows={3} /></Box>) : <TextField label="Policy text" value={editing.text || ''} onChange={e => setEditing({ ...editing, text: e.target.value })} fullWidth multiline minRows={4} />}
      </>)}
      {error && <Alert severity="error">{error}</Alert>}
    </Stack></DialogContent><DialogActions><Button onClick={() => setEditing(null)} disabled={busy}>Cancel</Button><Button variant="contained" disabled={busy || (section === 'outcomes' && !editing?.label?.trim())} onClick={save}>{busy ? 'Saving…' : 'Save changes'}</Button></DialogActions></Dialog>
  </Box>;
};
export default ReferenceLibraryTab;
