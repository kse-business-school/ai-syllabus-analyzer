import React, { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Chip from '@mui/material/Chip';
import Tooltip from '@mui/material/Tooltip';
import CircularProgress from '@mui/material/CircularProgress';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import Button from '@mui/material/Button';
import Switch from '@mui/material/Switch';
import FormControlLabel from '@mui/material/FormControlLabel';
import Alert from '@mui/material/Alert';
import CloseOutlined from '@mui/icons-material/CloseOutlined';
import api from '../../services/api';
import { USE_MOCKS } from '../../services/workspaceClient';

// PLO mastery level chip
const LevelChip = ({ level, onClick }) => {
  if (!level) {
    return (
      <Box
        onClick={onClick}
        sx={{
          width: 24,
          height: 24,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 0.5,
          color: 'text.muted',
          fontSize: '0.75rem',
          cursor: 'pointer',
          '&:hover': { bgcolor: 'action.hover' },
        }}
      >
        —
      </Box>
    );
  }

  const colorMap = {
    I: { label: 'I', title: 'Introduced', bg: 'var(--status-info-bg)', fg: 'var(--status-info-text)' },
    R: { label: 'R', title: 'Reinforced', bg: 'var(--status-warning-bg)', fg: 'var(--status-warning-text)' },
    M: { label: 'M', title: 'Mastered', bg: 'var(--status-approved-bg)', fg: 'var(--status-approved-text)' },
  };
  const conf = colorMap[level] || colorMap.I;

  return (
    <Box
      onClick={onClick}
      title={conf.title}
      sx={{
        width: 24,
        height: 24,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 0.5,
        bgcolor: conf.bg,
        color: conf.fg,
        fontWeight: 700,
        fontSize: '0.6875rem',
        cursor: 'pointer',
        transition: 'transform 0.1s ease',
        '&:hover': { transform: 'scale(1.15)' },
      }}
    >
      {conf.label}
    </Box>
  );
};

const PloCoverageTab = ({ programCode = 'MBA' }) => {
  const [outcomes, setOutcomes] = useState([]);
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showDemoMatrix, setShowDemoMatrix] = useState(Boolean(USE_MOCKS));
  const [drawerData, setDrawerData] = useState(null); // { course, plo, level }

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([
      api.references.outcomes(programCode).catch(() => ({ data: [] })),
      api.references.courses(programCode).catch(() => ({ data: [] })),
    ])
      .then(([outcomesRes, coursesRes]) => {
        if (!active) return;
        const outList = outcomesRes.data?.outcomes || (Array.isArray(outcomesRes.data) ? outcomesRes.data : []);
        const crsList = coursesRes.data?.courses || (Array.isArray(coursesRes.data) ? coursesRes.data : []);
        setOutcomes(outList);
        setCourses(crsList);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [programCode]);

  // Demo coverage generator when demo preview is enabled
  const getCoverageLevel = (courseIndex, outcomeIndex) => {
    if (!showDemoMatrix) return null;
    const hash = (courseIndex * 7 + outcomeIndex * 13) % 10;
    if (hash === 1 || hash === 4) return 'I';
    if (hash === 2 || hash === 7) return 'R';
    if (hash === 3 || hash === 8) return 'M';
    return null;
  };

  return (
    <Box>
      <Box
        sx={{
          display: 'flex',
          alignItems: { xs: 'flex-start', sm: 'center' },
          justifyContent: 'space-between',
          flexDirection: { xs: 'column', sm: 'row' },
          gap: 1.5,
          mb: 2,
        }}
      >
        <Box>
          <Typography variant="h2" sx={{ fontSize: '0.9375rem', fontWeight: 600, mb: 0.5 }}>
            Programme Learning Outcomes (PLO) Matrix
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', fontSize: '0.8125rem' }}>
            Alignment of course-level outcomes with programmatic competency standards ({programCode}).
          </Typography>
        </Box>

        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={showDemoMatrix}
              onChange={(e) => setShowDemoMatrix(e.target.checked)}
            />
          }
          label={
            <Typography variant="body2" sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>
              Preview demo matrix
            </Typography>
          }
        />
      </Box>

      {/* Honest banner about real references vs cross-syllabus aggregation */}
      <Alert
        severity="info"
        sx={{
          mb: 2,
          borderRadius: 1,
          py: 0.5,
          bgcolor: 'background.paper',
          borderColor: 'divider',
          borderWidth: 1,
          borderStyle: 'solid',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <Typography variant="body2" sx={{ fontSize: '0.8125rem' }}>
            Live PLO definitions loaded from institutional reference library.
          </Typography>
          {showDemoMatrix ? (
            <Chip
              label="Demo data (preview)"
              size="small"
              color="warning"
              sx={{ height: 18, fontSize: '0.6875rem', fontWeight: 600 }}
            />
          ) : (
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              Automatic syllabus CLO→PLO cross-mapping backend endpoint is pending. Toggle preview above to see matrix layout.
            </Typography>
          )}
        </Box>
      </Alert>

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress size={28} />
        </Box>
      ) : outcomes.length === 0 ? (
        <Alert severity="warning">No PLO outcomes configured for programme {programCode}.</Alert>
      ) : (
        <TableContainer component={Paper} variant="outlined" sx={{ borderColor: 'divider', maxHeight: '65vh' }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell
                  sx={{
                    fontWeight: 600,
                    fontSize: '0.75rem',
                    bgcolor: 'background.default',
                    minWidth: 200,
                    position: 'sticky',
                    left: 0,
                    zIndex: 3,
                  }}
                >
                  Course
                </TableCell>
                {outcomes.map((plo, i) => (
                  <TableCell
                    key={plo.code || plo.id || i}
                    align="center"
                    sx={{
                      fontWeight: 600,
                      fontSize: '0.6875rem',
                      bgcolor: 'background.default',
                      whiteSpace: 'nowrap',
                      px: 1,
                    }}
                  >
                    <Tooltip title={plo.description || plo.title || `PLO ${i + 1}`}>
                      <Box sx={{ cursor: 'help' }}>{plo.code || `PLO ${i + 1}`}</Box>
                    </Tooltip>
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {courses.map((course, cIdx) => (
                <TableRow key={course.code || course.id || cIdx} hover>
                  <TableCell
                    sx={{
                      py: 1,
                      fontWeight: 600,
                      fontSize: '0.8125rem',
                      position: 'sticky',
                      left: 0,
                      bgcolor: 'background.paper',
                      zIndex: 1,
                      borderRight: '1px solid',
                      borderColor: 'divider',
                    }}
                  >
                    <Typography variant="body2" sx={{ fontWeight: 600, fontSize: '0.8125rem' }}>
                      {course.name || course.title}
                    </Typography>
                    {course.code && (
                      <Typography variant="caption" sx={{ color: 'text.muted' }}>
                        {course.code}
                      </Typography>
                    )}
                  </TableCell>
                  {outcomes.map((plo, pIdx) => {
                    const level = getCoverageLevel(cIdx, pIdx);
                    return (
                      <TableCell key={plo.code || pIdx} align="center" sx={{ py: 0.75, px: 0.5 }}>
                        <LevelChip
                          level={level}
                          onClick={() => setDrawerData({ course, plo, level })}
                        />
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* Drawer для інспекції комірки матриці */}
      <Drawer
        anchor="right"
        open={Boolean(drawerData)}
        onClose={() => setDrawerData(null)}
        PaperProps={{ sx: { width: { xs: '100%', sm: 400 }, p: 3, bgcolor: 'background.paper' } }}
      >
        {drawerData && (
          <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
              <Typography variant="h2" sx={{ fontSize: '1rem', fontWeight: 600 }}>
                PLO Competency Details
              </Typography>
              <IconButton size="small" onClick={() => setDrawerData(null)}>
                <CloseOutlined fontSize="small" />
              </IconButton>
            </Box>

            <Paper variant="outlined" sx={{ p: 2, mb: 2.5, bgcolor: 'background.default' }}>
              <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, display: 'block', mb: 0.5 }}>
                Course
              </Typography>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {drawerData.course.name || drawerData.course.title} ({drawerData.course.code})
              </Typography>
            </Paper>

            <Paper variant="outlined" sx={{ p: 2, mb: 2.5, bgcolor: 'background.default' }}>
              <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, display: 'block', mb: 0.5 }}>
                Programme Learning Outcome ({drawerData.plo.code})
              </Typography>
              <Typography variant="body2" sx={{ fontSize: '0.8125rem', lineHeight: 1.55 }}>
                {drawerData.plo.description || drawerData.plo.title || 'Institutional outcome description.'}
              </Typography>
            </Paper>

            <Box sx={{ mb: 3 }}>
              <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, display: 'block', mb: 1 }}>
                Coverage Status
              </Typography>
              {drawerData.level ? (
                <Chip
                  label={
                    drawerData.level === 'I'
                      ? 'Introduced (Foundation concept)'
                      : drawerData.level === 'R'
                      ? 'Reinforced (Applied practice)'
                      : 'Mastered (Capstone / Executive level)'
                  }
                  size="small"
                  color={drawerData.level === 'M' ? 'success' : drawerData.level === 'R' ? 'warning' : 'info'}
                  sx={{ fontWeight: 600 }}
                />
              ) : (
                <Typography variant="body2" sx={{ color: 'text.muted', fontStyle: 'italic', fontSize: '0.8125rem' }}>
                  No mapping recorded yet for this course.
                </Typography>
              )}
            </Box>

            <Box sx={{ mt: 'auto', pt: 2, borderTop: '1px solid', borderColor: 'divider' }}>
              <Button fullWidth variant="outlined" size="small" onClick={() => setDrawerData(null)}>
                Close
              </Button>
            </Box>
          </Box>
        )}
      </Drawer>
    </Box>
  );
};

export default PloCoverageTab;
