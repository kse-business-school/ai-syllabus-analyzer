import React, { useEffect, useRef } from 'react';
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
import DocumentBlocks from './document/DocumentBlocks';
import { S } from '../../strings';

const LiveDocumentPanel = ({
  document,
  templateSections = [],
  diff = false,
  onToggleDiff,
  focusedKey = null,
  onApproveSection,
  onDiscussSection,
  readOnly = false,
}) => {
  const scrollRef = useRef(null);
  const sections = document?.sections;
  const titles = new Map(templateSections.map((s) => [s.key, s]));

  useEffect(() => {
    if (!focusedKey || !scrollRef.current) return;
    const el = scrollRef.current.querySelector(`[data-section="${focusedKey}"]`);
    if (el) {
      scrollRef.current.scrollTo({
        top: el.getBoundingClientRect().top - scrollRef.current.getBoundingClientRect().top + scrollRef.current.scrollTop - 16,
        behavior: 'smooth',
      });
    }
  }, [focusedKey, sections]);

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
              const hasContent = Boolean(sec.blocks?.length);

              return (
                <Box
                  key={sec.key}
                  data-section={sec.key}
                  sx={{
                    mb: 3.5,
                    pl: 2,
                    borderLeft: '3px solid',
                    borderColor: focused ? 'primary.main' : 'transparent',
                    transition: 'border-color 0.2s ease',
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
                        {onDiscussSection && (
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
                        {hasContent && onApproveSection && (
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

                  {hasContent ? (
                    <DocumentBlocks blocks={sec.blocks} diff={diff} />
                  ) : (
                    <Typography
                      variant="body2"
                      sx={{
                        color: 'text.muted',
                        fontStyle: 'italic',
                        fontSize: '0.8125rem',
                        bgcolor: 'background.default',
                        p: 1.5,
                        borderRadius: 1,
                        border: '1px dashed',
                        borderColor: 'divider',
                      }}
                    >
                      {S.documentEmpty}
                    </Typography>
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
