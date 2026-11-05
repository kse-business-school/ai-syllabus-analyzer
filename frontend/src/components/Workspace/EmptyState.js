import React, { useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Select from '@mui/material/Select';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import CloudUploadOutlined from '@mui/icons-material/CloudUploadOutlined';
import AutoAwesomeOutlined from '@mui/icons-material/AutoAwesomeOutlined';
import DescriptionOutlined from '@mui/icons-material/DescriptionOutlined';
import CheckCircleOutline from '@mui/icons-material/CheckCircleOutline';
import LaunchOutlined from '@mui/icons-material/LaunchOutlined';
import { useDropzone } from 'react-dropzone';
import client from '../../services/workspaceClient';
import { describeError } from '../../utils/apiError';
import { S, ERROR_MESSAGES } from '../../strings';

const ACCEPTED_FILES = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
  'application/msword': ['.doc'],
  'application/pdf': ['.pdf'],
};

const EmptyState = ({ onUploaded }) => {
  const [mode, setMode] = useState('entry');
  const [title, setTitle] = useState('');
  const [courseCode, setCourseCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [file, setFile] = useState(null);
  const [programs, setPrograms] = useState([]);
  const [programId, setProgramId] = useState('');
  const [programCode, setProgramCode] = useState('');
  const [loading, setLoading] = useState(true);
  const [existingSyllabus, setExistingSyllabus] = useState(null);
  const [allSyllabi, setAllSyllabi] = useState([]);
  // Призначення курс × набір (CourseOffering): викладач бачить лише свої; силабус прив'язується через offeringId
  const [offerings, setOfferings] = useState([]);
  const [offeringId, setOfferingId] = useState('');

  useEffect(() => {
    let active = true;
    Promise.all([
      client.references.programs(),
      client.cabinet ? client.cabinet.getSyllabi().catch(() => ({ data: [] })) : Promise.resolve({ data: [] }),
      client.cabinet?.listOfferings ? client.cabinet.listOfferings().catch(() => ({ data: { offerings: [] } })) : Promise.resolve({ data: { offerings: [] } }),
    ])
      .then(([progRes, sylRes, offRes]) => {
        if (!active) return;
        const list = Array.isArray(progRes?.data) ? progRes.data : [];
        setPrograms(list);
        if (list.length > 0) {
          // Без прив'язки до конкретної програми: перша зі списку, найновіший набір
          const initial = list[0];
          setProgramId(initial.id);
          setProgramCode(initial.editions?.at(-1)?.code || (initial.editions?.length ? '' : initial.code));
        }
        const sList = Array.isArray(sylRes?.data) ? sylRes.data : (sylRes?.data?.syllabi || []);
        setAllSyllabi(sList);
        setOfferings(Array.isArray(offRes?.data?.offerings) ? offRes.data.offerings : []);
      })
      .catch(async (err) => {
        const info = await describeError(err, S.errLoadPrograms);
        if (active) setError(info.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const editions = programs.find((p) => p.id === programId)?.editions || [];
  const selectedProgram = programs.find((p) => p.id === programId);
  const selectedCohort = programCode || selectedProgram?.code || '';

  const handleProgramChange = (id) => {
    setProgramId(id);
    setOfferingId('');
    const p = programs.find((item) => item.id === id);
    // Найновіший набір програми; програма без наборів сама є кодом довідників
    setProgramCode(p?.editions?.at(-1)?.code || (p?.editions?.length ? '' : p?.code) || '');
  };

  // Призначення для обраного набору; вибір заповнює назву, код і набір з призначення
  const cohortOfferings = offerings.filter((o) => String(o.programCode || '').toUpperCase() === String(selectedCohort).toUpperCase());
  const selectedOffering = offerings.find((o) => String(o._id) === String(offeringId)) || null;
  const handleOfferingChange = (id) => {
    setOfferingId(id);
    const o = offerings.find((item) => String(item._id) === String(id));
    if (!o) return;
    setCourseCode(o.courseCode || '');
    if (o.courseName) setTitle(o.courseName);
    const owner = programs.find((p) => (p.editions || []).some((e) => e.code === o.programCode));
    if (owner) {
      setProgramId(owner.id);
      setProgramCode(o.programCode);
    }
  };

  useEffect(() => {
    const cleanTitle = title.trim().toLowerCase();
    const cleanCode = courseCode.trim().toLowerCase();
    if (!cleanTitle && !cleanCode) {
      setExistingSyllabus(null);
      return;
    }
    const found = allSyllabi.find((s) => {
      const sylProg = (s.programCode || s.cohort || '').toLowerCase();
      const matchCohort = sylProg && selectedCohort && sylProg === selectedCohort.toLowerCase();
      const matchTitle = cleanTitle && (s.title || s.courseName || '').toLowerCase() === cleanTitle;
      const matchCode = cleanCode && (s.courseCode || '').toLowerCase() === cleanCode;
      return matchCohort && (matchTitle || matchCode);
    });
    setExistingSyllabus(found || null);
  }, [title, courseCode, selectedCohort, allSyllabi]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: ACCEPTED_FILES,
    maxSize: 10 * 1024 * 1024,
    multiple: false,
    disabled: busy,
    onDrop: (files) => {
      if (files[0]) {
        setMode('upload');
        setFile(files[0]);
        setError('');
        if (!title) setTitle(files[0].name.replace(/\.[^.]+$/, ''));
      }
    },
    onDropRejected: (fileRejections) => {
      const rej = fileRejections[0];
      if (rej?.errors?.some((e) => e.code === 'file-too-large')) {
        setError(ERROR_MESSAGES.FILE_TOO_LARGE);
      } else {
        setError(ERROR_MESSAGES.UNSUPPORTED_FORMAT);
      }
    },
  });

  const submit = async (e) => {
    e.preventDefault();
    if (!title.trim()) return setError(S.errCourseTitle);
    if (!programId) return setError(S.errProgram);
    if (!selectedCohort) return setError(S.errCohort);
    if (mode === 'upload' && !file) return setError('Please choose a DOCX, DOC or PDF file.');

    setBusy(true);
    setError('');

    try {
      let response;
      const codeToSend = selectedCohort;

      if (mode === 'scratch') {
        response = await client.syllabus.create({
          title: title.trim(),
          programId,
          programCode: codeToSend,
          ...(courseCode.trim() ? { courseCode: courseCode.trim() } : {}),
          ...(selectedOffering ? { offeringId: selectedOffering._id } : {}),
        });
      } else {
        const fd = new FormData();
        fd.append('syllabus', file);
        fd.append('courseName', title.trim());
        fd.append('programId', programId);
        fd.append('programCode', codeToSend);
        if (courseCode.trim()) fd.append('courseCode', courseCode.trim());
        if (selectedOffering) fd.append('offeringId', selectedOffering._id);
        response = await client.syllabus.upload(fd);
      }

      const data = response.data;
      const id = data.syllabusId || data.syllabus?.id || data.syllabus?._id;
      if (!id) throw new Error('The server did not return a syllabus ID.');
      onUploaded?.(id);
    } catch (err) {
      const info = await describeError(err, mode === 'scratch' ? S.errCreate : S.errUpload);
      setError(info.message);
      // Пара курс × набір уже має силабус: пропонуємо відкрити його
      if (info.code === 'OFFERING_TAKEN' && info.data?.syllabusId) {
        setExistingSyllabus({ id: info.data.syllabusId, title: title.trim(), programCode: selectedCohort });
      }
    } finally {
      setBusy(false);
    }
  };

  if (mode === 'entry') return <Box sx={{ maxWidth: 520, mx: 'auto', px: 3, py: { xs: 4, md: 7 }, textAlign: 'center' }}>
    <Typography component="h1" sx={{ fontSize: 25, fontWeight: 700, lineHeight: 1.3, mb: 1.5 }}>Let’s build your syllabus</Typography>
    <Typography variant="body2" color="text.secondary" sx={{ mb: 4 }}>I’ll take you through it section by section. Upload your draft, or start with a new course.</Typography>
    {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
    <Box {...getRootProps()} sx={{ border: '1px dashed', borderColor: isDragActive ? 'primary.main' : 'text.muted', p: 4, mb: 2.5, cursor: 'pointer', bgcolor: isDragActive ? 'background.band' : 'background.paper', '&:hover': { bgcolor: 'background.band' } }}>
      <input {...getInputProps()} aria-label="Upload syllabus draft" />
      <CloudUploadOutlined sx={{ fontSize: 28, color: 'text.secondary', mb: 1 }} />
      <Typography sx={{ fontWeight: 700, fontSize: 15 }}>Drop your draft here</Typography>
      <Typography variant="caption" color="text.secondary">or click to browse · DOCX, DOC, PDF</Typography>
    </Box>
    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2.5 }}>or</Typography>
    <Button variant="outlined" size="large" onClick={() => setMode('scratch')}>Start from scratch</Button>
    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 3 }}>Your instructor details are carried over automatically.</Typography>
  </Box>;

  return (
    <Box
      sx={{
        maxWidth: 680,
        mx: 'auto',
        py: { xs: 3, md: 4 },
        px: 2,
        height: '100%',
        overflowY: 'auto',
      }}
    >
      <Box sx={{ mb: 3, textAlign: 'center' }}>
        <Typography
          variant="h1"
          sx={{
            fontSize: '1.5rem',
            fontWeight: 700,
            letterSpacing: '-0.02em',
            color: 'text.primary',
            mb: 1,
          }}
        >
          {S.welcomeTitle}
        </Typography>
        <Typography variant="body1" sx={{ color: 'text.secondary', maxWidth: 560, mx: 'auto' }}>
          {S.welcomeHint}
        </Typography>
      </Box>

      {/* Перемикач двох карток: Upload existing vs Start from scratch */}
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 3 }}>
        <Paper
          component="button" type="button" aria-pressed={mode === 'upload'}
          variant="outlined"
          onClick={() => {
            setMode('upload');
            setError('');
          }}
          sx={{
            p: 2,
            textAlign: 'left',
            flex: 1,
            cursor: 'pointer',
            borderWidth: 2,
            borderColor: mode === 'upload' ? 'primary.main' : 'divider',
            bgcolor: mode === 'upload' ? 'background.default' : 'background.paper',
            transition: 'border-color 0.15s ease',
            '&:hover': { borderColor: 'primary.main' },
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
            <DescriptionOutlined
              sx={{ color: mode === 'upload' ? 'primary.main' : 'text.secondary', fontSize: 20 }}
            />
            <Typography variant="h2" sx={{ fontSize: '0.9375rem', fontWeight: 600 }}>
              {S.haveDraft}
            </Typography>
          </Box>
          <Typography variant="body2" sx={{ color: 'text.secondary', fontSize: '0.8125rem' }}>
            {S.haveDraftHint}
          </Typography>
        </Paper>

        <Paper component="button" type="button" aria-pressed={mode === 'scratch'}
          variant="outlined"
          onClick={() => {
            setMode('scratch');
            setError('');
          }}
          sx={{
            p: 2,
            textAlign: 'left',
            flex: 1,
            cursor: 'pointer',
            borderWidth: 2,
            borderColor: mode === 'scratch' ? 'primary.main' : 'divider',
            bgcolor: mode === 'scratch' ? 'background.default' : 'background.paper',
            transition: 'border-color 0.15s ease',
            '&:hover': { borderColor: 'primary.main' },
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
            <AutoAwesomeOutlined
              sx={{ color: mode === 'scratch' ? 'primary.main' : 'text.secondary', fontSize: 20 }}
            />
            <Typography variant="h2" sx={{ fontSize: '0.9375rem', fontWeight: 600 }}>
              {S.fromScratch}
            </Typography>
          </Box>
          <Typography variant="body2" sx={{ color: 'text.secondary', fontSize: '0.8125rem' }}>
            {S.fromScratchHint}
          </Typography>
        </Paper>
      </Stack>

      {/* Якщо знайдено існуючий силабус для цієї пари курс × набір */}
      {existingSyllabus && (
        <Paper
          variant="outlined"
          sx={{
            p: 2,
            mb: 3,
            borderColor: 'primary.main',
            bgcolor: 'action.hover',
            borderRadius: 0,
          }}
        >
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'center' }} justifyContent="space-between">
            <Box>
              <Typography variant="subtitle2" sx={{ fontWeight: 600, color: 'text.primary' }}>
                A syllabus for this course and cohort already exists:
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {existingSyllabus.title || existingSyllabus.courseName} · {existingSyllabus.programCode || selectedCohort}
              </Typography>
            </Box>
            <Button
              variant="contained"
              size="small"
              endIcon={<LaunchOutlined />}
              onClick={() => onUploaded?.(existingSyllabus.id || existingSyllabus._id)}
              sx={{ flexShrink: 0 }}
            >
              Open existing syllabus
            </Button>
          </Stack>
        </Paper>
      )}

      {/* Основна форма */}
      <Paper
        variant="outlined"
        component="form"
        onSubmit={submit}
        sx={{
          p: { xs: 2, sm: 2.5 },
          bgcolor: 'background.paper',
          borderColor: 'divider',
        }}
      >
        {error && (
          <Alert severity="error" sx={{ mb: 2.5, borderRadius: 0 }} onClose={() => setError('')}>
            {error}
          </Alert>
        )}

        {mode === 'upload' && (
          <Box sx={{ mb: 3 }}>
            <Box
              {...getRootProps()}
              sx={{
                border: '2px dashed',
                borderColor: isDragActive ? 'primary.main' : file ? 'success.main' : 'divider',
                borderRadius: 0,
                p: 3,
                textAlign: 'center',
                cursor: busy ? 'default' : 'pointer',
                bgcolor: isDragActive ? 'background.default' : file ? 'action.hover' : 'background.default',
                transition: 'all 0.15s ease',
                '&:hover': { borderColor: 'primary.main' },
              }}
            >
              <input {...getInputProps()} />
              {file ? (
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1 }}>
                  <CheckCircleOutline sx={{ color: 'success.main', fontSize: 24 }} />
                  <Box sx={{ textAlign: 'left' }}>
                    <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.primary' }}>
                      {file.name}
                    </Typography>
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                      {(file.size / 1024 / 1024).toFixed(2)} MB · Ready to analyze
                    </Typography>
                  </Box>
                </Box>
              ) : (
                <Box>
                  <CloudUploadOutlined sx={{ fontSize: 32, color: 'text.secondary', mb: 1 }} />
                  <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.primary', mb: 0.5 }}>
                    {isDragActive ? S.dropHere : S.dropOrClick}
                  </Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
                    {S.fileFormats}
                  </Typography>
                </Box>
              )}
            </Box>
          </Box>
        )}

        <Stack spacing={2.5}>
          {cohortOfferings.length > 0 && (
            <FormControl fullWidth size="small" disabled={busy}>
              <InputLabel id="offering-select-label" shrink>
                {S.assignedCourse}
              </InputLabel>
              <Select
                labelId="offering-select-label"
                value={offeringId}
                label={S.assignedCourse}
                displayEmpty
                onChange={(e) => handleOfferingChange(e.target.value)}
              >
                <MenuItem value="">{S.assignedCourseNone}</MenuItem>
                {cohortOfferings.map((o) => (
                  <MenuItem key={o._id} value={o._id}>
                    {o.courseCode}{o.courseName ? ` · ${o.courseName}` : ''} · {o.type}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          )}

          <TextField
            label={S.courseTitle}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={busy}
            fullWidth
            required
            size="small"
            placeholder="E.g., Applied Corporate Finance"
            InputLabelProps={{ shrink: true }}
          />

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label={S.courseCode}
              value={courseCode}
              onChange={(e) => setCourseCode(e.target.value)}
              disabled={busy || Boolean(selectedOffering)}
              size="small"
              sx={{ flex: 1 }}
              placeholder="FIN502"
              InputLabelProps={{ shrink: true }}
            />

            <FormControl fullWidth size="small" sx={{ flex: 1.5 }} disabled={busy || loading}>
              <InputLabel id="program-select-label" shrink>
                {S.program}
              </InputLabel>
              <Select
                labelId="program-select-label"
                value={programId}
                label={S.program}
                onChange={(e) => handleProgramChange(e.target.value)}
              >
                {programs.map((p) => (
                  <MenuItem key={p.id} value={p.id}>
                    {p.name || p.code}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            {editions.length > 0 && (
              <FormControl fullWidth size="small" sx={{ flex: 1.5 }} disabled={busy}>
                <InputLabel id="edition-select-label" shrink>
                  {S.edition}
                </InputLabel>
                <Select
                  labelId="edition-select-label"
                  value={programCode}
                  label={S.edition}
                  onChange={(e) => { setProgramCode(e.target.value); setOfferingId(''); }}
                >
                  {editions.map((ed) => (
                    <MenuItem key={ed.code} value={ed.code}>
                      {ed.label || ed.code}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}
          </Stack>

          {/* Індикатор обраного набору (cohort) */}
          {selectedCohort && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="caption" color="text.secondary">
                Target cohort:
              </Typography>
              <Chip
                label={selectedCohort}
                size="small"
                variant="outlined"
                sx={{ height: 22, fontSize: '0.75rem', fontWeight: 600 }}
              />
            </Box>
          )}



          <Box sx={{ display: 'flex', justifyContent: 'flex-end', pt: 1 }}>
            <Button
              type="submit"
              variant="contained"
              disabled={busy || loading || !selectedCohort || (mode === 'upload' && !file)}
              startIcon={busy ? <CircularProgress size={16} color="inherit" /> : null}
              sx={{ minWidth: 160, py: 1 }}
            >
              {busy
                ? mode === 'scratch'
                  ? S.creating
                  : S.uploading
                : mode === 'scratch'
                ? S.create
                : S.uploadAndAnalyze}
            </Button>
          </Box>
        </Stack>
      </Paper>
    </Box>
  );
};

export default EmptyState;
