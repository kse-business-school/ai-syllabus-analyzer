import React, { useEffect, useRef, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
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
import DocumentBlocks from './document/DocumentBlocks';
import { S } from '../../strings';

const LiveDocumentPanel = ({
  document,
  templateSections = [],
  diff = false,
  onToggleDiff,
  focusedKey = null,
  highlightedSectionKey = null,
  checks = [],
  readiness = null,
  onApproveSection,
  onDiscussSection,
  readOnly = false,
}) => {
  const scrollRef = useRef(null);
  const sections = document?.sections;
  const titles = new Map(templateSections.map((s) => [s.key, s]));
  const [activeHighlight, setActiveHighlight] = useState(null);

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
        bgcolor: 'background.default',
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
      </Box>

      {document?.loading && <LinearProgress sx={{ height: 2 }} />}

      {/* Контейнер листа документа */}
      <Box
        ref={scrollRef}
        sx={{
          flexGrow: 1,
          overflowY: 'auto',
          p: { xs: 2, md: 3 },
          position: 'relative',
        }}
      >
        {document?.error && (
          <Alert severity="error" sx={{ mb: 2, borderRadius: 1 }}>
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
              p: { xs: 2.5, md: 4 },
              bgcolor: 'background.paper',
              borderColor: 'divider',
              boxShadow: (t) => t.palette.mode === 'dark' ? 'none' : '0 1px 3px rgba(0,0,0,0.06)',
            }}
          >
            {sections.map((sec) => {
              const meta = titles.get(sec.key);
              const docTitle = meta?.docTitle;
              const groupHeading =
                sec.docNumber && sec.docNumber !== lastDocNumber && docTitle && docTitle !== sec.title
                  ? `${sec.docNumber}. ${docTitle}`
                  : null;
              const ownHeading = groupHeading
                ? sec.title
                : sec.docNumber && sec.docNumber !== lastDocNumber
                ? `${sec.docNumber}. ${sec.title}`
                : sec.title;
              lastDocNumber = sec.docNumber ?? lastDocNumber;
              const focused = focusedKey === sec.key;
              const isHighlighted = activeHighlight === sec.key;
              const hasContent = Boolean(sec.blocks?.length);
              const gaps = readiness?.sections?.[sec.key]?.gaps || [];
              const failedChecks = (checks || []).filter(
                (c) => c.passed === false && (c.section === sec.key || c.target?.section === sec.key)
              );
              const isLocked = sec.locked || sec.mode === 'locked';

              return (
                <Box
                  key={sec.key}
                  data-section={sec.key}
                  sx={{
                    mb: 3.5,
                    p: 1.5,
                    pl: 2,
                    borderRadius: 1,
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
                        {hasContent && onApproveSection && !isLocked && (
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
                        borderRadius: 1,
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
                        borderRadius: 1,
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
