import React, { useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import Snackbar from '@mui/material/Snackbar';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import Typography from '@mui/material/Typography';
import Tooltip from '@mui/material/Tooltip';
import Add from '@mui/icons-material/Add';
import Delete from '@mui/icons-material/Delete';
import Edit from '@mui/icons-material/Edit';
import Close from '@mui/icons-material/Close';
import api from '../../services/api';

const ProgramsTab = ({ programs, reload }) => {
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);
  const empty = { name: '', code: '', academicDirectorEmail: '', editions: [] };
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const [snack, setSnack] = useState('');

  // Набори (редакції) програми: код набору — ключ довідників (ПРН, нормативні курси, Capstone) і призначень.
  // Новий набір можна почати з копії довідників наявного набору (copyFrom).
  const allCohorts = programs.flatMap((p) => (p.editions || []).map((e) => e.code));
  const openCreate = () => { setForm(empty); setCreating(true); };
  const openEdit = (p) => {
    setEditing(p._id);
    setForm({
      name: p.name, code: p.code, academicDirectorEmail: p.academicDirectorEmail || '',
      editions: (p.editions || []).map((e) => ({ code: e.code, label: e.label || '', copyFrom: '', isNew: false })),
    });
  };
  const setEdition = (i, patch) => setForm((f) => ({ ...f, editions: f.editions.map((e, j) => (j === i ? { ...e, ...patch } : e)) }));
  const addEdition = () => setForm((f) => ({
    ...f,
    editions: [...f.editions, { code: '', label: '', copyFrom: f.editions.at(-1)?.code || '', isNew: true }],
  }));
  const removeEdition = (i) => setForm((f) => ({ ...f, editions: f.editions.filter((_, j) => j !== i) }));
  const editionsPayload = () => form.editions
    .filter((e) => e.code.trim())
    .map((e) => ({ code: e.code.trim().toUpperCase(), label: e.label.trim(), ...(e.isNew && e.copyFrom ? { copyFrom: e.copyFrom } : {}) }));

  const save = async () => {
    setSaving(true);
    try {
      if (editing) {
        await api.cabinet.updateProgram(editing, { name: form.name, academicDirectorEmail: form.academicDirectorEmail, editions: editionsPayload() });
      } else {
        await api.cabinet.createProgram({ name: form.name, code: form.code, academicDirectorEmail: form.academicDirectorEmail, editions: editionsPayload() });
      }
      setEditing(null);
      setCreating(false);
      setSnack(editing ? "Programme updated" : "Programme created");
      reload();
    } catch (err) {
      setSnack(err.response?.data?.message || "Could not save changes");
    } finally {
      setSaving(false);
    }
  };

  const del = async (id) => {
    if (!window.confirm("Delete this programme?")) return;
    try {
      await api.cabinet.deleteProgram(id);
      setSnack("Deleted");
      reload();
    } catch (err) {
      setSnack(err.response?.data?.message || "Could not delete");
    }
  };

  const isOpen = creating || !!editing;

  return (
    <Box>
      <Stack direction="row" sx={{ mb: 2 }}>
        <Button startIcon={<Add />} variant="contained" size="small" onClick={openCreate}>Add programme</Button>
      </Stack>
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Code</TableCell>
              <TableCell>Title</TableCell>
              <TableCell>Cohorts</TableCell>
              <TableCell>Academic director email</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {programs.map((p) => (
              <TableRow key={p._id} hover>
                <TableCell><Chip label={p.code} size="small" variant="outlined" /></TableCell>
                <TableCell>{p.name}</TableCell>
                <TableCell>
                  {(p.editions || []).length
                    ? <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>{p.editions.map((e) => <Chip key={e.code} label={e.code} size="small" title={e.label || e.code} />)}</Stack>
                    : '—'}
                </TableCell>
                <TableCell>{p.academicDirectorEmail || '—'}</TableCell>
                <TableCell align="right">
                  <Tooltip title="Edit"><IconButton size="small" onClick={() => openEdit(p)}><Edit fontSize="small" /></IconButton></Tooltip>
                  <Tooltip title="Delete"><IconButton size="small" color="error" onClick={() => del(p._id)}><Delete fontSize="small" /></IconButton></Tooltip>
                </TableCell>
              </TableRow>
            ))}
            {programs.length === 0 && (
              <TableRow><TableCell colSpan={5} align="center" sx={{ py: 3, color: 'text.secondary' }}>No programmes yet</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog open={isOpen} onClose={() => { setCreating(false); setEditing(null); }} maxWidth="sm" fullWidth>
        <DialogTitle>{editing ? "Edit programme" : "Add programme"}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {!editing && (
              <TextField label="Code (e.g. MBA)" size="small" fullWidth value={form.code}
                onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))} />
            )}
            <TextField label="Title" size="small" fullWidth value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            <TextField label="Academic director email" size="small" fullWidth value={form.academicDirectorEmail}
              onChange={(e) => setForm((f) => ({ ...f, academicDirectorEmail: e.target.value }))} />

            <Box>
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Cohorts</Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                Each cohort (for example MBA29 or EMBA25) has its own programme outcomes, core courses and Capstone guide.
                A new cohort can start from a copy of an existing one. Without cohorts, the programme code is used.
                A cohort with syllabi or course assignments cannot be removed. List cohorts from oldest to newest.
              </Typography>
              <Stack spacing={1}>
                {form.editions.map((e, i) => (
                  <Stack key={i} direction="row" spacing={1} alignItems="center">
                    <TextField label="Code" size="small" value={e.code} disabled={!e.isNew} sx={{ width: 120 }}
                      onChange={(ev) => setEdition(i, { code: ev.target.value.toUpperCase() })} placeholder="MBA29" />
                    <TextField label="Label" size="small" value={e.label} sx={{ flex: 1 }}
                      onChange={(ev) => setEdition(i, { label: ev.target.value })} placeholder="MBA29 (2027-28 intake)" />
                    {e.isNew && (
                      <TextField select label="Copy references from" size="small" value={e.copyFrom} sx={{ width: 170 }}
                        onChange={(ev) => setEdition(i, { copyFrom: ev.target.value })}>
                        <MenuItem value="">Start empty</MenuItem>
                        {allCohorts.map((c) => <MenuItem key={c} value={c}>{c}</MenuItem>)}
                      </TextField>
                    )}
                    <Tooltip title="Remove cohort"><IconButton size="small" aria-label={`Remove cohort ${e.code}`} onClick={() => removeEdition(i)}><Close fontSize="small" /></IconButton></Tooltip>
                  </Stack>
                ))}
                <Box><Button size="small" startIcon={<Add />} onClick={addEdition}>Add cohort</Button></Box>
              </Stack>
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setCreating(false); setEditing(null); }}>Cancel</Button>
          <Button variant="contained" onClick={save} disabled={saving || !form.name || (!editing && !form.code)}>
            {saving ? <CircularProgress size={18} /> : "Save"}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={!!snack} autoHideDuration={4000} onClose={() => setSnack('')} message={snack} />
    </Box>
  );
};

export default ProgramsTab;
