import React, { useEffect, useRef, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import CircularProgress from '@mui/material/CircularProgress';
import LinearProgress from '@mui/material/LinearProgress';
import Paper from '@mui/material/Paper';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import Tooltip from '@mui/material/Tooltip';
import CheckCircleOutline from '@mui/icons-material/CheckCircleOutline';
import ChatBubbleOutline from '@mui/icons-material/ChatBubbleOutline';
import WarningAmber from '@mui/icons-material/WarningAmber';
import ArrowForward from '@mui/icons-material/ArrowForward';
import LockOpenOutlined from '@mui/icons-material/LockOpenOutlined';
import DocumentBlocks from './document/DocumentBlocks';
import { S } from '../../strings';
import { sectionStatus } from '../../utils/sectionGroups';
import PolicyChoiceCard from './suggestions/PolicyChoiceCard';

const LiveDocumentPanel = ({
  instructors = [],
  document,
  templateSections = [],
  diff = false,
  onToggleDiff,
  focusedKey = null,
  highlightedSectionKey = null,
  checks = [],
  readiness = null,
  onApproveSection,
  onUnapproveSection,
  onDiscussSection,
  language = null,
  onChangeLanguage,
  policyLibrary = {},
  programBlocks = [],
  programBlock = null,
  statePolicies = [],
  actions = null,
  busy = false,
  readOnly = false,
}) => {
  const scrollRef = useRef(null);
  const sections = document?.sections;
  const titles = new Map(templateSections.map((s) => [s.key, s]));
  const [activeHighlight, setActiveHighlight] = useState(null);
  const [pendingLanguage, setPendingLanguage] = useState(null);
  const [policyKey, setPolicyKey] = useState(null);
  // B-3.2: library-політики без рішення — кнопка «Choose an option» у документі відкриває ті самі пресети, що й картка в чаті
  const undecidedPolicies = statePolicies.filter((p) => p.mode !== 'locked' && !p.optionKey
    && !['instructor_directed', 'fixture_edited'].includes(p.source) && policyLibrary[p.key]);
  const hasText = (sections || []).some((s) => s.blocks?.length);
  // B-1.2: на заповненому документі — окрема дія з попередженням; написаний текст не перекладається
  const requestLanguage = (value) => {
    if (!value || value === language) return;
    if (hasText) setPendingLanguage(value);
    else onChangeLanguage?.(value);
  };

  useEffect(() => {
    if (!highlightedSectionKey) return undefined;
    setActiveHighlight(highlightedSectionKey);
    const timer = setTimeout(() => setActiveHighlight(null), 2000);
    return () => clearTimeout(timer);
  }, [highlightedSectionKey]);

  useEffect(() => {
    const targetKey = activeHighlight || focusedKey;
    if (!targetKey || !scrollRef.current) return;
    const el = scrollRef.current.querySelector(`[data-section="${targetKey}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [focusedKey, activeHighlight]);

  let lastDocNumber = null;

  return (
    <Box
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        bgcolor: 'background.paper',
        minWidth: 0,
        borderLeft: '1px solid',
        borderColor: 'divider',
        '@keyframes highlightFade': {
          '0%': { bgcolor: 'action.selected' },
          '100%': { bgcolor: 'transparent' },
        },
      }}
    >
      {/* Шапка документа */}
      <Box
        sx={{
          p: 1.5,
          px: 2,
          borderBottom: '1px solid',
          borderColor: 'divider',
          bgcolor: 'background.paper',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 1,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Typography variant="h2" sx={{ fontSize: '0.9375rem', fontWeight: 600 }}>
            {S.document}
          </Typography>
          <ToggleButtonGroup
            value={diff ? 'changes' : 'clean'}
            exclusive
            size="small"
            aria-label="Document view"
            onChange={(e, val) => val && onToggleDiff?.(val === 'changes')}
            sx={{ height: 26, '& .MuiToggleButton-root': { textTransform: 'none', fontSize: '0.75rem', px: 1.25, py: 0 } }}
          >
            <ToggleButton value="clean">{S.cleanView}</ToggleButton>
            <ToggleButton value="changes">{S.showChanges}</ToggleButton>
          </ToggleButtonGroup>
        </Box>
        {language && onChangeLanguage && (
          <TextField select size="small" label="Document language" value={language} disabled={readOnly}
            onChange={(e) => requestLanguage(e.target.value)} sx={{ minWidth: 150, '& .MuiInputBase-root': { height: 30, fontSize: '0.75rem' } }}>
            <MenuItem value="en">English</MenuItem>
            <MenuItem value="uk">Ukrainian</MenuItem>
          </TextField>
        )}
      </Box>
      <Dialog open={Boolean(policyKey)} onClose={() => setPolicyKey(null)} maxWidth="md" fullWidth>
        <DialogContent sx={{ p: 2 }}>
          {policyKey && (
            <PolicyChoiceCard
              policyKey={policyKey}
              policy={policyLibrary[policyKey]}
              statePolicy={statePolicies.find((p) => p.key === policyKey)}
              actions={{
                ...actions,
                choosePolicy: async (key, option) => { const r = await actions.choosePolicy(key, option); if (r?.ok) setPolicyKey(null); return r; },
                writeOwnPolicy: async (key) => { const r = await actions.writeOwnPolicy(key); if (r?.ok) setPolicyKey(null); return r; },
              }}
              busy={busy}
              readOnly={readOnly}
              language={language}
            />
          )}
        </DialogContent>
        <DialogActions><Button onClick={() => setPolicyKey(null)}>Close</Button></DialogActions>
      </Dialog>
      <Dialog open={Boolean(pendingLanguage)} onClose={() => setPendingLanguage(null)}>
        <DialogTitle>Change the document language?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Text that is already in the syllabus stays as it is and is not translated. New drafts, questions about the content and checks will use {pendingLanguage === 'uk' ? 'Ukrainian' : 'English'}.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPendingLanguage(null)}>Cancel</Button>
          <Button variant="contained" onClick={() => { onChangeLanguage?.(pendingLanguage); setPendingLanguage(null); }}>Change language</Button>
        </DialogActions>
      </Dialog>

      {document?.loading && <LinearProgress sx={{ height: 2 }} />}

      {/* Контейнер листа документа */}
      <Box
        ref={scrollRef}
        sx={{
          flexGrow: 1,
          overflowY: 'auto',
          p: { xs: 1, md: 2 },
          position: 'relative',
        }}
      >
        {document?.error && (
          <Alert severity="error" sx={{ mb: 2, borderRadius: 0 }}>
            {document.error}
          </Alert>
        )}

        {!sections && !document?.error && (
          <Box sx={{ display: 'flex', justifyContent: 'center', mt: 6 }}>
            <CircularProgress size={28} />
          </Box>
        )}

        {sections && (
          <Paper
            variant="outlined"
            sx={{
              maxWidth: 760,
              mx: 'auto',
              p: { xs: 1, md: 1.5 },
              bgcolor: 'background.paper',
              borderColor: 'divider',
              boxShadow: 'none',
            }}
          >
            {sections.map((sec) => {
              const meta = titles.get(sec.key);
              // Назву групи бекенд віддає мовою документа (sec.docTitle); номер 0 — теж номер (профіль MMM)
              const docTitle = sec.docTitle || meta?.docTitle;
              const numbered = sec.docNumber != null;
              const groupHeading =
                numbered && sec.docNumber !== lastDocNumber && docTitle && docTitle !== sec.title
                  ? `${sec.docNumber}. ${docTitle}`
                  : null;
              const ownHeading = groupHeading
                ? sec.title
                : numbered && sec.docNumber !== lastDocNumber
                ? `${sec.docNumber}. ${sec.title}`
                : sec.title;
              // Підказка слота (B-6.5): лише в UI, у .docx не потрапляє
              const hint = meta?.hint?.en || meta?.hint?.uk || null;
              lastDocNumber = sec.docNumber ?? lastDocNumber;
              const focused = focusedKey === sec.key;
              const isHighlighted = activeHighlight === sec.key;
              const hasContent = Boolean(sec.blocks?.length);
              const gaps = readiness?.sections?.[sec.key]?.gaps || [];
              const failedChecks = (checks || []).filter(
                (c) => c.passed === false && (c.section === sec.key || c.target?.section === sec.key)
              );
              const isLocked = sec.locked || sec.mode === 'locked';
              const isApproved = Boolean(readiness?.sections?.[sec.key]?.approved);
              const status = readiness?.sections?.[sec.key] ? sectionStatus(readiness.sections[sec.key]) : null;

              return (
                <Box
                  key={sec.key}
                  data-section={sec.key}
                  sx={{
                    mb: 3.5,
                    p: 1.5,
                    pl: 2,
                    borderRadius: 0,
                    borderLeft: '3px solid',
                    borderColor: focused ? 'primary.main' : 'transparent',
                    transition: 'border-color 0.2s ease, background-color 0.2s ease',
                    ...(isHighlighted && {
                      animation: 'highlightFade 2s ease-out',
                      bgcolor: 'action.hover',
                      '@media (prefers-reduced-motion: reduce)': {
                        animation: 'none',
                        bgcolor: 'action.hover',
                      },
                    }),
                  }}
                >
                  {groupHeading && (
                    <Typography
                      variant="h1"
                      sx={{
                        fontSize: '1.125rem',
                        fontWeight: 700,
                        mb: 1.5,
                        color: 'text.primary',
                        borderBottom: '1px solid',
                        borderColor: 'divider',
                        pb: 0.5,
                      }}
                    >
                      {groupHeading}
                    </Typography>
                  )}

                  {sec.key === 'instructor' && instructors.filter(i => i.photo).map(i => <Box component="img" key={i.id} src={i.photo} alt={`${i.name || 'Instructor'} profile`} sx={{ width: 88, height: 88, objectFit: 'cover', mb: 2 }} />)}

                  <Box
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      mb: 1,
                      gap: 1,
                    }}
                  >
                    <Typography
                      variant="h2"
                      sx={{
                        fontSize: '0.9375rem',
                        fontWeight: 600,
                        color: 'text.primary',
                      }}
                    >
                      {ownHeading}
                      {/* B-5.1/B-5.4: затверджено — позначка; готовий, але не затверджений — підказка, що дія лишилась */}
                      {!isLocked && status === 'approved' && (
                        <Chip size="small" color="success" variant="outlined" icon={<CheckCircleOutline sx={{ fontSize: 13 }} />} label="Approved" sx={{ ml: 1, height: 20, fontSize: '0.6875rem', verticalAlign: 'middle' }} />
                      )}
                      {!isLocked && status === 'ready' && (
                        <Chip size="small" variant="outlined" label="Ready to approve" sx={{ ml: 1, height: 20, fontSize: '0.6875rem', verticalAlign: 'middle', borderColor: 'success.main', color: 'success.main' }} />
                      )}
                    </Typography>

                    {/* Інтерактивні кнопки секції */}
                    {!readOnly && (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                        {onDiscussSection && !isLocked && (
                          <Tooltip title="Discuss or draft this section in chat">
                            <Button
                              size="small"
                              variant="text"
                              startIcon={<ChatBubbleOutline sx={{ fontSize: 13 }} />}
                              onClick={() => onDiscussSection(sec.key, ownHeading)}
                              sx={{
                                fontSize: '0.6875rem',
                                py: 0.2,
                                px: 0.75,
                                color: 'text.secondary',
                                '&:hover': { color: 'text.primary' },
                              }}
                            >
                              Discuss
                            </Button>
                          </Tooltip>
                        )}
                        {isApproved && onUnapproveSection && (
                          <Tooltip title="Reopen this section for changes; it will need approval again">
                            <Button
                              size="small"
                              variant="outlined"
                              startIcon={<LockOpenOutlined sx={{ fontSize: 13 }} />}
                              onClick={() => onUnapproveSection(sec.key)}
                              sx={{ fontSize: '0.6875rem', py: 0.2, px: 0.75, borderColor: 'divider', color: 'text.secondary' }}
                            >
                              Reopen
                            </Button>
                          </Tooltip>
                        )}
                        {hasContent && onApproveSection && !isLocked && !isApproved && (
                          <Tooltip title="Approve this section">
                            <Button
                              size="small"
                              variant="outlined"
                              startIcon={<CheckCircleOutline sx={{ fontSize: 13 }} />}
                              onClick={() => onApproveSection(sec.key)}
                              sx={{
                                fontSize: '0.6875rem',
                                py: 0.2,
                                px: 0.75,
                                borderColor: 'divider',
                                color: 'success.main',
                                '&:hover': { borderColor: 'success.main', bgcolor: 'var(--status-approved-bg)' },
                              }}
                            >
                              Approve
                            </Button>
                          </Tooltip>
                        )}
                      </Box>
                    )}
                  </Box>

                  {hint && !readOnly && (
                    <Typography variant="caption" component="p" sx={{ color: 'text.secondary', fontStyle: 'italic', mb: 1, whiteSpace: 'pre-line' }}>
                      {hint}
                    </Typography>
                  )}

                  {/* B-8.6: корпус і блок програми — закритий список програми */}
                  {sec.key === 'at_a_glance' && programBlocks.length > 0 && actions?.setProgramBlock && (
                    <TextField select size="small" fullWidth label={language === 'uk' ? 'Корпус і блок програми' : 'Programme block'}
                      value={programBlock || ''} disabled={readOnly || busy} sx={{ mb: 1.5 }}
                      onChange={(e) => actions.setProgramBlock(e.target.value || null)}>
                      <MenuItem value=""><em>—</em></MenuItem>
                      {programBlocks.map((b) => <MenuItem key={b.code} value={b.label}>{b.group ? `${b.label} · ${b.group}` : b.label}</MenuItem>)}
                    </TextField>
                  )}

                  {sec.key === 'policies' && !readOnly && actions && undecidedPolicies.length > 0 && (
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mb: 1.5 }}>
                      {undecidedPolicies.map((p) => (
                        <Button key={p.key} size="small" variant="outlined" color="warning" onClick={() => setPolicyKey(p.key)}
                          sx={{ fontSize: '0.6875rem', py: 0.2, textTransform: 'none' }}>
                          {`Choose an option: ${policyLibrary[p.key]?.title || p.key}`}
                        </Button>
                      ))}
                    </Box>
                  )}

                  {/* Позначки регуляторних перевірок */}
                  {failedChecks.map((c, idx) => (
                    <Alert
                      key={c.id || idx}
                      severity={c.severity === 'critical' ? 'error' : 'warning'}
                      icon={<WarningAmber fontSize="small" />}
                      sx={{
                        my: 1,
                        py: 0.25,
                        px: 1.25,
                        borderRadius: 0,
                        '& .MuiAlert-message': { fontSize: '0.75rem', lineHeight: 1.3 },
                      }}
                    >
                      <Typography variant="caption" sx={{ fontWeight: 600, display: 'block' }}>
                        {c.message}
                      </Typography>
                      {c.details?.rule && (
                        <Typography variant="caption" color="text.secondary">
                          Academic policy: {c.details.rule}
                        </Typography>
                      )}
                    </Alert>
                  ))}

                  {hasContent ? (
                    <DocumentBlocks
                      blocks={sec.blocks}
                      diff={diff}
                      sectionKey={sec.key}
                      isLocked={isLocked}
                      readOnly={readOnly}
                      onSlotChange={(slotKey) => onDiscussSection?.(slotKey || sec.key, ownHeading)}
                    />
                  ) : (
                    <Box
                      sx={{
                        p: 1.5,
                        borderRadius: 0,
                        bgcolor: 'background.default',
                        border: '1px dashed',
                        borderColor: 'divider',
                      }}
                    >
                      <Typography
                        variant="body2"
                        sx={{
                          color: 'text.muted',
                          fontSize: '0.8125rem',
                          mb: gaps.length > 0 && !readOnly ? 1 : 0,
                        }}
                      >
                        {gaps.length > 0 ? `Required content missing: ${gaps.join(' · ')}` : S.documentEmpty}
                      </Typography>
                      {!readOnly && onDiscussSection && (
                        <Button
                          size="small"
                          variant="text"
                          endIcon={<ArrowForward sx={{ fontSize: 13 }} />}
                          onClick={() => onDiscussSection(sec.key, ownHeading)}
                          sx={{ fontSize: '0.75rem', p: 0, minWidth: 0, textTransform: 'none' }}
                        >
                          Answer in chat →
                        </Button>
                      )}
                    </Box>
                  )}
                </Box>
              );
            })}

            {!sections.length && (
              <Typography variant="body2" color="text.secondary">
                {S.documentEmpty}
              </Typography>
            )}
          </Paper>
        )}
      </Box>
    </Box>
  );
};

export default LiveDocumentPanel;
