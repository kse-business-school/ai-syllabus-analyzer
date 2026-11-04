import React, { useCallback, useEffect, useState, useMemo } from 'react';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import IconButton from '@mui/material/IconButton';
import LinearProgress from '@mui/material/LinearProgress';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Select from '@mui/material/Select';
import Snackbar from '@mui/material/Snackbar';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import ChatOutlined from '@mui/icons-material/ChatOutlined';
import DeleteOutline from '@mui/icons-material/DeleteOutline';
import FileDownloadOutlined from '@mui/icons-material/FileDownloadOutlined';
import RefreshOutlined from '@mui/icons-material/RefreshOutlined';
import VisibilityOutlined from '@mui/icons-material/VisibilityOutlined';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';
import { docxFallbackName, filenameFromDisposition, saveBlob } from '../../utils/files';
import { computeGroupedReadiness } from '../../utils/sectionGroups';

const statusColor = { in_progress: 'warning', analyzing: 'info', error: 'error' };
const statusLabel = { in_progress: 'In progress', analyzing: 'Analyzing', error: 'Error' };

const StatusChip = ({ status }) => (
  <Chip
    label={statusLabel[status] || status || '—'}
    size="small"
    color={statusColor[status] || 'default'}
    sx={{ height: 20, fontSize: '0.6875rem', fontWeight: 600 }}
  />
);

const GroupedReadinessCell = ({ syllabus }) => {
  const readiness = syllabus.readiness;
  const grouped = computeGroupedReadiness(readiness);

  if (grouped.isEmpty) {
    return (
      <Typography variant="body2" sx={{ color: 'text.muted', fontVariantNumeric: 'tabular-nums' }}>
        —
      </Typography>
    );
  }

  return (
    <Box sx={{ minWidth: 140 }}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
        <Typography variant="body2" sx={{ fontWeight: 600, fontSize: '0.8125rem', fontVariantNumeric: 'tabular-nums' }}>
          {grouped.percent}%
        </Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>
          {grouped.approvedCount} of {grouped.totalCount} approved
        </Typography>
      </Stack>
      <LinearProgress
        variant="determinate"
        value={grouped.percent || 0}
        sx={{
          height: 5,
          borderRadius: 999,
          bgcolor: 'background.default',
          '& .MuiLinearProgress-bar': {
            bgcolor: grouped.approvedCount === grouped.totalCount ? 'success.main' : 'primary.main',
          },
        }}
      />
    </Box>
  );
};

const SyllabiTab = ({ programs = [], isAdmin, user, filterMineOnly = false, onChanged }) => {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [program, setProgram] = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState('');
  const [snack, setSnack] = useState('');
  const userId = user?.id || user?._id || '';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.cabinet.getSyllabi({ program, status, page: 1, limit: 50 });
      let list = data.syllabi || [];
      if (filterMineOnly && isAdmin) {
        list = list.filter((s) => s.ownerId === userId || s.userId === userId);
      }
      setRows(list);
    } catch (err) {
      setSnack(err.response?.data?.message || 'Could not load syllabi');
    } finally {
      setLoading(false);
    }
  }, [program, status, filterMineOnly, isAdmin, userId]);

  useEffect(() => {
    load();
  }, [load]);

  const filteredRows = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.toLowerCase();
    return rows.filter((r) =>
      (r.title || '').toLowerCase().includes(q) ||
      (r.courseName || '').toLowerCase().includes(q) ||
      (r.programCode || '').toLowerCase().includes(q)
    );
  }, [rows, search]);

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this syllabus? This action cannot be undone.')) return;
    setDeletingId(id);
    try {
      await api.syllabus.deleteSyllabus(id);
      setSnack('Syllabus deleted');
      load();
      onChanged?.();
    } catch (err) {
      setSnack(err.response?.data?.message || 'Could not delete syllabus');
    } finally {
      setDeletingId('');
    }
  };

  const handleDownload = async (id, title) => {
    try {
      const res = await api.chat.downloadDocx(id);
      const filename = filenameFromDisposition(res.headers['content-disposition']) || docxFallbackName(title);
      saveBlob(res.data, filename);
    } catch (err) {
      setSnack('Could not download .docx document');
    }
  };

  return (
    <Box>
      {/* Фільтри та панель пошуку */}
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1.5}
        alignItems={{ sm: 'center' }}
        justifyContent="space-between"
        sx={{ mb: 2 }}
      >
        <Stack direction="row" spacing={1.5} alignItems="center" useFlexGap flexWrap="wrap">
          <TextField
            placeholder="Search by course or title…"
            size="small"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            sx={{ width: { xs: '100%', sm: 220 } }}
          />

          <Select
            size="small"
            value={program}
            onChange={(e) => setProgram(e.target.value)}
            displayEmpty
            sx={{ minWidth: 150 }}
          >
            <MenuItem value="">All programmes</MenuItem>
            {programs.map((p) => (
              <MenuItem key={p.id || p.code} value={p.code}>
                {p.name || p.code}
              </MenuItem>
            ))}
          </Select>

          <Select
            size="small"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            displayEmpty
            sx={{ minWidth: 130 }}
          >
            <MenuItem value="">All statuses</MenuItem>
            <MenuItem value="in_progress">In progress</MenuItem>
            <MenuItem value="analyzing">Analyzing</MenuItem>
            <MenuItem value="error">Error</MenuItem>
          </Select>
        </Stack>

        <IconButton size="small" onClick={load} disabled={loading} title="Refresh syllabi">
          <RefreshOutlined fontSize="small" />
        </IconButton>
      </Stack>

      {/* Таблиця силабусів */}
      <TableContainer component={Paper} variant="outlined" sx={{ borderColor: 'divider' }}>
        <Table size="small">
          <TableHead sx={{ bgcolor: 'background.default' }}>
            <TableRow>
              <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem', py: 1 }}>Course &amp; Title</TableCell>
              <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem', py: 1 }}>Programme</TableCell>
              <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem', py: 1 }}>Status</TableCell>
              <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem', py: 1 }}>Readiness</TableCell>
              <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem', py: 1, textAlign: 'right' }}>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading && rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} align="center" sx={{ py: 5 }}>
                  <CircularProgress size={24} />
                </TableCell>
              </TableRow>
            ) : filteredRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                  No course syllabi found matching current criteria.
                </TableCell>
              </TableRow>
            ) : (
              filteredRows.map((row) => {
                const isOwner = row.ownerId === userId || row.userId === userId;
                return (
                  <TableRow key={row._id || row.id} hover sx={{ '&:last-child td': { borderBottom: 0 } }}>
                    <TableCell sx={{ py: 1.25 }}>
                      <Typography
                        variant="body2"
                        sx={{
                          fontWeight: 600,
                          fontSize: '0.8125rem',
                          color: 'text.primary',
                          cursor: 'pointer',
                          '&:hover': { color: 'primary.main', textDecoration: 'underline' },
                        }}
                        onClick={() => navigate(`/workspace/${row._id || row.id}`)}
                      >
                        {row.title || row.courseName || 'Untitled Course'}
                      </Typography>
                      {row.courseCode && (
                        <Typography variant="caption" sx={{ color: 'text.muted', display: 'block' }}>
                          Code: {row.courseCode}
                        </Typography>
                      )}
                    </TableCell>

                    <TableCell sx={{ py: 1.25 }}>
                      <Chip
                        label={row.programCode || 'MBA'}
                        size="small"
                        variant="outlined"
                        sx={{ height: 20, fontSize: '0.6875rem', fontWeight: 500 }}
                      />
                    </TableCell>

                    <TableCell sx={{ py: 1.25 }}>
                      <StatusChip status={row.status} />
                    </TableCell>

                    <TableCell sx={{ py: 1.25 }}>
                      <GroupedReadinessCell syllabus={row} />
                    </TableCell>

                    <TableCell align="right" sx={{ py: 1.25 }}>
                      <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                        <Tooltip title={isOwner ? 'Open workspace' : 'View syllabus (Read-only Admin)'}>
                          <IconButton
                            size="small"
                            onClick={() => navigate(`/workspace/${row._id || row.id}`)}
                            color="primary"
                          >
                            {isOwner ? <ChatOutlined fontSize="small" /> : <VisibilityOutlined fontSize="small" />}
                          </IconButton>
                        </Tooltip>

                        <Tooltip title="Export .docx">
                          <IconButton
                            size="small"
                            onClick={() => handleDownload(row._id || row.id, row.title || row.courseName)}
                          >
                            <FileDownloadOutlined fontSize="small" />
                          </IconButton>
                        </Tooltip>

                        {isOwner && (
                          <Tooltip title="Delete syllabus">
                            <IconButton
                              size="small"
                              onClick={() => handleDelete(row._id || row.id)}
                              disabled={deletingId === (row._id || row.id)}
                              color="error"
                            >
                              <DeleteOutline fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        )}
                      </Stack>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Snackbar
        open={Boolean(snack)}
        autoHideDuration={4000}
        onClose={() => setSnack('')}
        message={snack}
      />
    </Box>
  );
};

export default SyllabiTab;
