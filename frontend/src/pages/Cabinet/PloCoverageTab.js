import React, { useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import CloseOutlined from '@mui/icons-material/CloseOutlined';
import api from '../../services/api';

// Критичне — один токен --flag (ТЗ, доповнення 29.10 §2); запасне значення, поки токена немає в темі
const FLAG = 'var(--flag, #62005F)';
const COURSE_LETTER = { core: 'C', elective: 'E' };

// Суцільна заливка — курс формує результат (1), штрихування — торкається (0,5), порожньо — 0.
// Пунктирна рамка з «?» — є зв'язки, яких викладач ще не підтвердив: у Σ вони не входять (аудит A07)
const Cell = ({ weight, pending = false, onClick, label }) => {
  const fill = pending && !(weight > 0)
    ? { border: '1px dashed', borderColor: 'text.secondary', color: 'text.secondary', fontSize: 11, fontWeight: 700, lineHeight: '22px' }
    : weight >= 1
    ? { bgcolor: 'brand.plate' }
    : weight > 0
      ? { backgroundImage: 'repeating-linear-gradient(135deg, currentColor 0 4px, transparent 4px 8px)', color: 'brand.plate', border: '1px solid', borderColor: 'divider' }
      : { border: '1px solid', borderColor: 'divider' };
  return (
    <Box
      component="button"
      type="button"
      onClick={onClick}
      aria-label={pending ? `${label} (links waiting for confirmation)` : label}
      sx={{ width: 24, height: 24, p: 0, display: 'block', mx: 'auto', cursor: 'pointer', borderRadius: 0, background: 'none', ...fill }}
    >
      {pending && !(weight > 0) ? '?' : null}
    </Box>
  );
};

const sumLabel = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const headCell = { fontWeight: 700, fontSize: '0.6875rem', letterSpacing: '0.04em', textTransform: 'uppercase', bgcolor: 'background.paper' };

const PloCoverageTab = ({ programCode }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null); // { course, outcome }

  useEffect(() => {
    if (!programCode) return undefined;
    let active = true;
    setLoading(true);
    setError('');
    api.cabinet.getPloCoverage(programCode)
      .then(({ data: body }) => { if (active) setData(body); })
      .catch((err) => {
        if (!active) return;
        setData(null);
        setError(err.response?.data?.message || 'Could not load PLO coverage.');
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [programCode]);

  const uncovered = data ? data.outcomes.filter((o) => o.uncovered) : [];
  const cellOf = (course, outcome) => course.cells[outcome.code] || null;

  return (
    <Box>
      <Typography variant="h2" sx={{ fontSize: '0.9375rem', fontWeight: 600, mb: 0.5 }}>PLO coverage</Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', fontSize: '0.8125rem', mb: 2 }}>
        Each cell comes from the CLO → PLO matrix of that course&apos;s syllabus. Filled: the course forms the outcome. Hatched: it touches it. Empty: not claimed.
      </Typography>

      {loading && <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress size={28} /></Box>}
      {!loading && !programCode && <Alert severity="info">Select a cohort to see its coverage.</Alert>}
      {!loading && error && <Alert severity="error">{error}</Alert>}

      {!loading && data && (
        <>
          {uncovered.length > 0 && (
            <Typography variant="body2" sx={{ mb: 1.5, fontSize: '0.8125rem', borderLeft: `3px solid ${FLAG}`, pl: 1.5 }}>
              {uncovered.length === 1 ? '1 programme outcome is' : `${uncovered.length} programme outcomes are`} not covered by any course in this cohort:{' '}
              {uncovered.map((o) => o.code).join(', ')}.
            </Typography>
          )}
          {data.courses.length === 0 ? (
            <Alert severity="warning">No courses are assigned to {data.programCode} yet. Add them in Courses &amp; cohorts.</Alert>
          ) : (
            <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 0, maxHeight: '68vh' }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ ...headCell, minWidth: 220 }}>Programme outcome</TableCell>
                    {data.courses.map((c) => (
                      <TableCell key={c.offeringId} align="center" sx={{ ...headCell, px: 1, whiteSpace: 'nowrap' }} title={c.courseName}>
                        {COURSE_LETTER[c.type] || ''} {c.courseCode}
                      </TableCell>
                    ))}
                    <TableCell align="center" sx={headCell}>Σ</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.outcomes.map((o) => (
                    <TableRow key={o.code} hover>
                      <TableCell sx={{ py: 0.75, borderLeft: o.uncovered ? `3px solid ${FLAG}` : '3px solid transparent' }}>
                        <Typography variant="body2" sx={{ fontWeight: 700, fontSize: '0.8125rem' }}>{o.code.replace('ПРН', 'PLO')} {o.label && `· ${o.label}`}</Typography>
                        <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {o.label ? '' : o.text}
                        </Typography>
                      </TableCell>
                      {data.courses.map((c) => {
                        const cell = cellOf(c, o);
                        return (
                          <TableCell key={c.offeringId} align="center" sx={{ py: 0.5, px: 0.5 }}>
                            <Cell
                              weight={cell?.weight || 0}
                              pending={Boolean(cell?.unconfirmed?.length)}
                              label={`${o.code} in ${c.courseCode}`}
                              onClick={() => setSelected({ course: c, outcome: o })}
                            />
                          </TableCell>
                        );
                      })}
                      <TableCell align="center" sx={{ fontWeight: 700, fontSize: '0.8125rem', color: o.uncovered ? FLAG : 'text.primary' }}>
                        {sumLabel(o.sum)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </>
      )}

      <Drawer
        anchor="right"
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        PaperProps={{ sx: { width: { xs: '100%', sm: 420 }, p: 3, borderRadius: 0 } }}
      >
        {selected && (() => {
          const cell = cellOf(selected.course, selected.outcome);
          return (
            <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                <Typography variant="h2" sx={{ fontSize: '1rem', fontWeight: 600 }}>{selected.outcome.code}</Typography>
                <IconButton size="small" aria-label="Close" onClick={() => setSelected(null)}><CloseOutlined fontSize="small" /></IconButton>
              </Box>
              {/* Офіційне формулювання ПРН лишається українською, як затверджено в освітній програмі */}
              <Typography variant="body2" sx={{ fontSize: '0.8125rem', lineHeight: 1.55, mb: 2.5 }}>{selected.outcome.text}</Typography>

              <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 700, letterSpacing: '0.04em' }}>COURSE</Typography>
              <Typography variant="body2" sx={{ fontWeight: 600, mb: 2.5 }}>
                {selected.course.courseName || selected.course.courseCode} ({selected.course.courseCode})
              </Typography>

              {cell ? (
                <>
                  {cell.clos.length > 0 && (
                  <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 700, letterSpacing: '0.04em' }}>
                    COURSE OUTCOMES · {cell.weight >= 1 ? 'FORMS THE OUTCOME' : 'TOUCHES THE OUTCOME'}
                  </Typography>
                  )}
                  {cell.clos.map((clo) => (
                    <Box key={clo.id} sx={{ py: 1.25, borderBottom: '1px solid', borderColor: 'divider' }}>
                      <Typography variant="body2" sx={{ fontSize: '0.8125rem' }}>{clo.text}</Typography>
                      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                        {clo.assessments.length
                          ? `Assessed by: ${clo.assessments.map((a) => (a.weight != null ? `${a.name} (${a.weight}%)` : a.name)).join(', ')}`
                          : 'No assessment component linked'}
                      </Typography>
                    </Box>
                  ))}
                  {cell.unconfirmed?.length > 0 && (
                    <>
                      <Typography variant="caption" sx={{ display: 'block', mt: 2, color: 'text.secondary', fontWeight: 700, letterSpacing: '0.04em' }}>
                        WAITING FOR THE INSTRUCTOR'S CONFIRMATION · NOT COUNTED
                      </Typography>
                      {cell.unconfirmed.map((clo) => (
                        <Box key={clo.id} sx={{ py: 1.25, borderBottom: '1px dashed', borderColor: 'divider' }}>
                          <Typography variant="body2" sx={{ fontSize: '0.8125rem', color: 'text.secondary' }}>{clo.text}</Typography>
                          <Typography variant="caption" sx={{ color: 'text.secondary' }}>{clo.coverage === 'partial' ? 'Partial link' : 'Full link'}</Typography>
                        </Box>
                      ))}
                    </>
                  )}
                </>
              ) : (
                <Typography variant="body2" sx={{ color: 'text.secondary', fontSize: '0.8125rem' }}>
                  {selected.course.syllabusId
                    ? 'This course does not claim this outcome.'
                    : 'This course has no syllabus yet, so nothing is claimed.'}
                </Typography>
              )}

              <Box sx={{ mt: 'auto', pt: 2 }}>
                <Button fullWidth variant="outlined" size="small" onClick={() => setSelected(null)}>Close</Button>
              </Box>
            </Box>
          );
        })()}
      </Drawer>
    </Box>
  );
};

export default PloCoverageTab;
