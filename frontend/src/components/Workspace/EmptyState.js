import React, { useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
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
import { useDropzone } from 'react-dropzone';
import client from '../../services/workspaceClient';
import { describeError } from '../../utils/apiError';
import { S, ERROR_MESSAGES } from '../../strings';

const ACCEPTED_DOCX = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
};

const EmptyState = ({ onUploaded }) => {
  const [mode, setMode] = useState('upload'); // Default to upload flow per spec
  const [title, setTitle] = useState('');
  const [courseCode, setCourseCode] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [file, setFile] = useState(null);
  const [programs, setPrograms] = useState([]);
  const [programId, setProgramId] = useState('');
  const [programCode, setProgramCode] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    client.references
      .programs()
      .then(({ data }) => {
        if (active) {
          const list = Array.isArray(data) ? data : [];
          setPrograms(list);
          if (list.length > 0) {
            setProgramId(list[0].id);
            setProgramCode(list[0].editions?.[0]?.code || list[0].code);
          }
        }
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

  const handleProgramChange = (id) => {
    setProgramId(id);
    const p = programs.find((item) => item.id === id);
    setProgramCode(p?.editions?.[0]?.code || p?.code || '');
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: ACCEPTED_DOCX,
    maxSize: 10 * 1024 * 1024,
    multiple: false,
    disabled: busy,
    onDrop: (files) => {
      if (files[0]) {
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
    if (mode === 'upload' && !file) return setError('Please choose a .docx syllabus document.');

    setBusy(true);
    setError('');

    try {
      let response;
      const activeProg = programs.find((p) => p.id === programId);
      const codeToSend = programCode || activeProg?.code || 'MBA';

      if (mode === 'scratch') {
        response = await client.syllabus.create({
          title: title.trim(),
          programId,
          programCode: codeToSend,
          ...(courseCode.trim() ? { courseCode: courseCode.trim() } : {}),
          ...(description.trim() ? { description: description.trim() } : {}),
        });
      } else {
        const fd = new FormData();
        fd.append('syllabus', file);
        fd.append('courseName', title.trim());
        fd.append('programId', programId);
        fd.append('programCode', codeToSend);
        if (courseCode.trim()) fd.append('courseCode', courseCode.trim());
        response = await client.syllabus.upload(fd);
      }

      const data = response.data;
      const id = data.syllabusId || data.syllabus?.id || data.syllabus?._id;
      if (!id) throw new Error('The server did not return a syllabus ID.');
      onUploaded?.(id);
    } catch (err) {
      const info = await describeError(err, mode === 'scratch' ? S.errCreate : S.errUpload);
      setError(info.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box
      sx={{
        maxWidth: 720,
        mx: 'auto',
        py: { xs: 3, md: 5 },
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
          variant="outlined"
          onClick={() => {
            setMode('upload');
            setError('');
          }}
          sx={{
            p: 2,
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

        <Paper
          variant="outlined"
          onClick={() => {
            setMode('scratch');
            setError('');
          }}
          sx={{
            p: 2,
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

      {/* Основна форма */}
      <Paper
        variant="outlined"
        component="form"
        onSubmit={submit}
        sx={{
          p: { xs: 2.5, sm: 3 },
          bgcolor: 'background.paper',
          borderColor: 'divider',
        }}
      >
        {error && (
          <Alert severity="error" sx={{ mb: 2.5, borderRadius: 1 }} onClose={() => setError('')}>
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
                borderRadius: 1.5,
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
              disabled={busy}
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
                  onChange={(e) => setProgramCode(e.target.value)}
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

          {mode === 'scratch' && (
            <TextField
              label="Brief course summary (optional)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={busy}
              multiline
              rows={2}
              size="small"
              placeholder="1–2 sentences about core topics, target audience, or learning philosophy…"
              InputLabelProps={{ shrink: true }}
            />
          )}

          <Box sx={{ display: 'flex', justifyContent: 'flex-end', pt: 1 }}>
            <Button
              type="submit"
              variant="contained"
              disabled={busy || loading || (mode === 'upload' && !file)}
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
