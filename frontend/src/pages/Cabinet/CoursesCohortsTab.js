import React, { useCallback, useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';

const EMPTY_FORM = { courseCode: '', courseName: '', type: 'elective', lecturerId: '', deadline: '' };
const headCell = { fontWeight: 700, fontSize: '0.6875rem', letterSpacing: '0.04em', textTransform: 'uppercase' };
const personName = (u) => (u ? [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email || '' : '');
const toDateInput = (value) => (value ? String(value).slice(0, 10) : '');
const sameCode = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

// Силабус цього призначення: за offeringId, інакше (старі силабуси) за кодом курсу
const syllabusOf = (offering, syllabi) => syllabi.find((s) => String(s.offeringId || '') === String(offering._id))
  || syllabi.find((s) => !s.offeringId && sameCode(s.course?.code, offering.courseCode))
  || null;

const CoursesCohortsTab = ({ programCode }) => {
  const navigate = useNavigate();
  const [offerings, setOfferings] = useState([]);
  const [syllabi, setSyllabi] = useState([]);
  const [coreCourses, setCoreCourses] = useState([]);
  const [lecturers, setLecturers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState(null); // { id|null, form }
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const load = useCallback(async () => {
    if (!programCode) return;
    setLoading(true);
    setError('');
    try {
      const [off, syl, crs, lec] = await Promise.all([
        api.cabinet.listOfferings({ programCode }),
        api.cabinet.getSyllabi({ scope: 'all', programCode, limit: 100 }).catch(() => ({ data: { syllabi: [] } })),
        api.references.courses(programCode).catch(() => ({ data: [] })),
        api.cabinet.listLecturers().catch(() => ({ data: { lecturers: [] } })),
      ]);
      setOfferings(off.data?.offerings || []);
      setSyllabi(syl.data?.syllabi || []);
      setCoreCourses(Array.isArray(crs.data) ? crs.data : []);
      setLecturers(lec.data?.lecturers || []);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not load courses.');
    } finally {
      setLoading(false);
    }
  }, [programCode]);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => { setFormError(''); setDialog({ id: null, form: EMPTY_FORM }); };
  const openEdit = (o) => {
    setFormError('');
    setDialog({
      id: o._id,
      form: {
        courseCode: o.courseCode, courseName: o.courseName || '', type: o.type,
        lecturerId: o.lecturerId?._id || '', deadline: toDateInput(o.deadline),
      },
    });
  };
  const setField = (patch) => setDialog((d) => ({ ...d, form: { ...d.form, ...patch } }));

  // Вибір нормативного курсу з довідника підставляє назву й тип core; довільний код лишається вільним
  const pickCourse = (value) => {
    if (value && typeof value === 'object') setField({ courseCode: value.code, courseName: value.en || value.uk || '', type: 'core' });
    else setField({ courseCode: value || '' });
  };

  const save = async () => {
    const { id, form } = dialog;
    if (!form.courseCode.trim()) { setFormError('Enter the course code.'); return; }
    setSaving(true);
    setFormError('');
    const payload = {
      courseName: form.courseName.trim(), type: form.type,
      lecturerId: form.lecturerId || null, deadline: form.deadline || null,
    };
    try {
      if (id) await api.cabinet.updateOffering(id, payload);
      else await api.cabinet.createOffering({ ...payload, programCode, courseCode: form.courseCode.trim() });
      setDialog(null);
      await load();
    } catch (err) {
      setFormError(err.response?.data?.message || 'Could not save the assignment.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (o) => {
    if (!window.confirm(`Remove ${o.courseCode} from ${programCode}?`)) return;
    try {
      await api.cabinet.deleteOffering(o._id);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not remove the assignment.');
    }
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2, mb: 2 }}>
        <Box>
          <Typography variant="h2" sx={{ fontSize: '0.9375rem', fontWeight: 600, mb: 0.5 }}>Courses &amp; cohorts</Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', fontSize: '0.8125rem' }}>
            A course can run in several cohorts and has its own type in each. The syllabus belongs to the course × cohort pair.
          </Typography>
        </Box>
        <Button variant="contained" size="small" onClick={openCreate} disabled={!programCode}>Assign course</Button>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {loading && <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress size={28} /></Box>}
      {!loading && !programCode && <Alert severity="info">Select a cohort to see its courses.</Alert>}
      {!loading && programCode && !error && offerings.length === 0 && (
        <Alert severity="info">No courses are assigned to {programCode} yet.</Alert>
      )}

      {!loading && offerings.length > 0 && (
        <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 0 }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={headCell}>Course</TableCell>
                <TableCell sx={headCell}>Type</TableCell>
                <TableCell sx={headCell}>Lecturer</TableCell>
                <TableCell sx={headCell}>Deadline</TableCell>
                <TableCell sx={headCell}>Syllabus</TableCell>
                <TableCell sx={{ ...headCell, textAlign: 'right' }} />
              </TableRow>
            </TableHead>
            <TableBody>
              {offerings.map((o) => {
                const syllabus = syllabusOf(o, syllabi);
                const score = syllabus?.readiness?.score;
                return (
                  <TableRow key={o._id} hover>
                    <TableCell sx={{ py: 1.25 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600, fontSize: '0.8125rem' }}>{o.courseName || o.courseCode}</Typography>
                      <Typography variant="caption" sx={{ color: 'text.secondary' }}>{o.courseCode}</Typography>
                    </TableCell>
                    <TableCell sx={{ fontSize: '0.8125rem' }}>{o.type}</TableCell>
                    <TableCell sx={{ fontSize: '0.8125rem' }}>{personName(o.lecturerId) || '—'}</TableCell>
                    <TableCell sx={{ fontSize: '0.8125rem' }}>{toDateInput(o.deadline) || '—'}</TableCell>
                    <TableCell sx={{ fontSize: '0.8125rem' }}>
                      {syllabus ? `Readiness ${score ?? 0}%` : 'Not started'}
                    </TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                      {syllabus && (
                        <Button size="small" onClick={() => navigate(`/workspace/${syllabus._id || syllabus.id}`)}>Open</Button>
                      )}
                      <Button size="small" onClick={() => openEdit(o)}>Edit</Button>
                      <Button size="small" onClick={() => remove(o)}>Remove</Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <Dialog open={Boolean(dialog)} onClose={() => !saving && setDialog(null)} fullWidth maxWidth="xs">
        <DialogTitle sx={{ fontSize: '1rem' }}>{dialog?.id ? 'Edit assignment' : `Assign course to ${programCode}`}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '8px !important' }}>
          {dialog && (
            <>
              <Autocomplete
                freeSolo
                disabled={Boolean(dialog.id)}
                options={coreCourses}
                getOptionLabel={(c) => (typeof c === 'string' ? c : `${c.code} · ${c.en || c.uk}`)}
                inputValue={dialog.form.courseCode}
                onInputChange={(_, value, reason) => { if (reason === 'input') pickCourse(value); }}
                onChange={(_, value) => { if (value) pickCourse(value); }}
                renderInput={(params) => <TextField {...params} size="small" label="Course code" />}
              />
              <TextField size="small" label="Course name" value={dialog.form.courseName} onChange={(e) => setField({ courseName: e.target.value })} />
              <TextField select size="small" label="Type in this cohort" value={dialog.form.type} onChange={(e) => setField({ type: e.target.value })}>
                <MenuItem value="core">core</MenuItem>
                <MenuItem value="elective">elective</MenuItem>
              </TextField>
              <TextField select size="small" label="Lecturer" value={dialog.form.lecturerId} onChange={(e) => setField({ lecturerId: e.target.value })}>
                <MenuItem value="">Not assigned</MenuItem>
                {lecturers.map((u) => <MenuItem key={u._id} value={u._id}>{personName(u)} ({u.email})</MenuItem>)}
              </TextField>
              <TextField size="small" type="date" label="Deadline" InputLabelProps={{ shrink: true }} value={dialog.form.deadline} onChange={(e) => setField({ deadline: e.target.value })} />
              {formError && <Alert severity="error">{formError}</Alert>}
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialog(null)} disabled={saving}>Cancel</Button>
          <Button variant="contained" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default CoursesCohortsTab;
