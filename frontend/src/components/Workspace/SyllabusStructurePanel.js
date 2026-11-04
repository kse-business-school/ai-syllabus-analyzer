import React, { useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import LinearProgress from '@mui/material/LinearProgress';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import Alert from '@mui/material/Alert';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogActions from '@mui/material/DialogActions';
import CheckCircle from '@mui/icons-material/CheckCircle';
import WarningAmber from '@mui/icons-material/WarningAmber';
import RadioButtonUnchecked from '@mui/icons-material/RadioButtonUnchecked';
import EditOutlined from '@mui/icons-material/EditOutlined';
import { computeGroupedReadiness } from '../../utils/sectionGroups';
import { S } from '../../strings';

const STATUS_ICONS = {
  approved: <CheckCircle sx={{ fontSize: 16, color: 'success.main' }} />,
  attention: <WarningAmber sx={{ fontSize: 16, color: 'error.main' }} />,
  needs_review: <EditOutlined sx={{ fontSize: 16, color: 'warning.main' }} />,
  empty: <RadioButtonUnchecked sx={{ fontSize: 16, color: 'text.muted' }} />,
};

const STATUS_DESCRIPTIONS = {
  approved: 'approved',
  attention: 'needs attention',
  needs_review: 'needs review',
  empty: 'empty',
};

const humanizeReason = (reason) => {
  if (!reason) return 'Missing required fields';
  if (reason === 'SECTION_INCOMPLETE') return 'Incomplete required content';
  if (reason === 'HAS_CRITICAL_CHECKS') return 'Has unresolved critical checks';
  return reason;
};

const SyllabusStructurePanel = ({
  readiness,
  state = {},
  focusedKey = null,
  onSelect,
  actions,
  busy = false,
  readOnly = false,
}) => {
  const grouped = computeGroupedReadiness(readiness, state);
  const [confirmGroup, setConfirmGroup] = useState(null);
  const [errorDetails, setErrorDetails] = useState(null); // { message, skipped: [], gaps: [] }

  const handleGroupClick = (group) => {
    onSelect?.(group.backendKeys[0]);
  };

  const handleApproveGroup = async (e, group) => {
    e.stopPropagation();
    setErrorDetails(null);

    if (group.backendKeys.length > 1) {
      const res = await actions?.approveAll(group.backendKeys);
      if (!res?.ok) {
        const rawGaps = res?.gaps || res?.data?.gaps || [];
        const gaps = rawGaps.map((g) => (typeof g === 'string' ? { key: group.backendKeys[0], gap: g } : g));
        setErrorDetails({
          message: res?.error === 'SECTION_INCOMPLETE' ? 'Some sections could not be approved because required content is missing:' : (res?.error || 'Could not approve all subsections'),
          gaps,
          skipped: res?.data?.skipped || res?.skipped || [],
        });
      } else if (res?.data?.skipped?.length > 0 || res?.skipped?.length > 0) {
        const skipped = res?.data?.skipped || res?.skipped || [];
        setErrorDetails({
          message: 'Some subsections could not be approved automatically:',
          skipped,
          gaps: [],
        });
      }
    } else {
      const res = await actions?.approveSection(group.backendKeys[0]);
      if (!res?.ok) {
        const rawGaps = res?.gaps || res?.data?.gaps || [];
        const gaps = rawGaps.map((g) => (typeof g === 'string' ? { key: group.backendKeys[0], gap: g } : g));
        setErrorDetails({
          message: res?.error === 'SECTION_INCOMPLETE' ? 'This section cannot be approved yet because required items are missing:' : (res?.error || 'Could not approve section'),
          gaps,
          skipped: [],
        });
      }
    }
  };

  const handleUnapproveGroup = async (e, group) => {
    e.stopPropagation();
    setConfirmGroup(group);
  };

  const confirmUnapprove = async () => {
    if (!confirmGroup) return;
    const group = confirmGroup;
    setConfirmGroup(null);
    for (const key of group.backendKeys) {
      await actions?.unapproveSection(key);
    }
  };

  return (
    <Box
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        bgcolor: 'background.paper',
        borderRight: '1px solid',
        borderColor: 'divider',
        width: '100%',
      }}
    >
      {/* Шапка прогресу готовності */}
      <Box sx={{ p: 2, pb: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
        <Stack direction="row" justifyContent="space-between" alignItems="baseline" sx={{ mb: 0.75 }}>
          <Typography variant="h2" sx={{ fontSize: '0.8125rem', fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            {S.structure}
          </Typography>
          <Typography variant="body2" sx={{ fontWeight: 600, color: grouped.isEmpty ? 'text.muted' : 'primary.main', fontVariantNumeric: 'tabular-nums' }}>
            {grouped.isEmpty ? '—' : `${grouped.approvedCount} of ${grouped.totalCount} approved`}
          </Typography>
        </Stack>

        <LinearProgress
          variant="determinate"
          value={grouped.percent || 0}
          sx={{
            height: 6,
            borderRadius: 999,
            bgcolor: 'background.default',
            '& .MuiLinearProgress-bar': {
              bgcolor: grouped.isAllApproved ? 'success.main' : 'primary.main',
            },
          }}
          aria-label={S.readiness}
        />

        <Typography variant="caption" sx={{ mt: 1, display: 'block', color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>
          {grouped.isEmpty ? 'New syllabus · 0 of 8 sections filled' : `${grouped.percent}% · ${grouped.approvedCount} of ${grouped.totalCount} approved`}
        </Typography>

        {errorDetails && (
          <Alert
            severity="warning"
            sx={{ mt: 1, py: 0.5, px: 1, '& .MuiAlert-message': { fontSize: '0.75rem' } }}
            onClose={() => setErrorDetails(null)}
          >
            <Typography variant="caption" sx={{ display: 'block', fontWeight: 600, mb: 0.25 }}>
              {errorDetails.message}
            </Typography>
            {errorDetails.gaps?.length > 0 && (
              <Box component="ul" sx={{ m: 0, pl: 2 }}>
                {errorDetails.gaps.map((item, idx) => (
                  <Box component="li" key={idx} sx={{ mt: 0.25 }}>
                    <Button
                      size="small"
                      variant="text"
                      color="inherit"
                      onClick={() => onSelect?.(item.key)}
                      sx={{
                        p: 0,
                        minWidth: 0,
                        fontSize: '0.75rem',
                        textDecoration: 'underline',
                        textTransform: 'none',
                        lineHeight: 1.2,
                      }}
                    >
                      {item.gap}
                    </Button>
                  </Box>
                ))}
              </Box>
            )}
            {errorDetails.skipped?.length > 0 && (
              <Box component="ul" sx={{ m: 0, pl: 2 }}>
                {errorDetails.skipped.map((s, idx) => (
                  <Box component="li" key={idx} sx={{ mt: 0.25 }}>
                    <Button
                      size="small"
                      variant="text"
                      color="inherit"
                      onClick={() => onSelect?.(s.key)}
                      sx={{
                        p: 0,
                        minWidth: 0,
                        fontSize: '0.75rem',
                        textDecoration: 'underline',
                        textTransform: 'none',
                        lineHeight: 1.2,
                      }}
                    >
                      {s.key}: {humanizeReason(s.reason)}
                    </Button>
                  </Box>
                ))}
              </Box>
            )}
          </Alert>
        )}
      </Box>

      {/* Список 8 логічних секцій */}
      <List sx={{ flex: '1 1 auto', overflowY: 'auto', py: 1, px: 0.75 }}>
        {grouped.groups.map((group) => {
          const isSelected = group.backendKeys.includes(focusedKey);
          const statusText = STATUS_DESCRIPTIONS[group.status] || group.status;
          const ariaLabel = `${group.title} — ${statusText}`;
          const missingSummary = group.gaps.length > 0 ? group.gaps.join(' · ') : null;
          const canApprove = group.complete && group.status !== 'attention';

          return (
            <Tooltip
              key={group.id}
              title={missingSummary || (group.isApproved ? S.approved : `${group.title} (${statusText})`)}
              placement="right"
              arrow
            >
              <ListItemButton
                onClick={() => handleGroupClick(group)}
                selected={isSelected}
                aria-label={ariaLabel}
                sx={{
                  py: 0.85,
                  px: 1.25,
                  borderRadius: 1,
                  mb: 0.5,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  transition: 'background-color 0.1s ease',
                  '&:focus-visible': {
                    outline: '2px solid',
                    outlineColor: 'primary.main',
                  },
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 0, flex: 1 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', flexShrink: 0 }} aria-hidden="true">
                    {STATUS_ICONS[group.status] || STATUS_ICONS.empty}
                  </Box>
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography
                      variant="body2"
                      sx={{
                        fontSize: '0.8125rem',
                        fontWeight: isSelected ? 600 : 500,
                        color: isSelected ? 'text.primary' : 'text.secondary',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {group.docNumber ? `${group.docNumber}. ${group.title}` : group.title}
                    </Typography>
                    {missingSummary && (
                      <Typography
                        variant="caption"
                        sx={{
                          display: 'none',
                          fontSize: '0.6875rem',
                          color: 'text.muted',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          '.MuiListItemButton-root:hover &, .MuiListItemButton-root:focus-visible &': {
                            display: 'block',
                          },
                        }}
                      >
                        {missingSummary}
                      </Typography>
                    )}
                  </Box>
                </Box>

                {/* Дія для секції */}
                {!readOnly && (
                  <Box sx={{ flexShrink: 0, ml: 1 }}>
                    {group.isApproved ? (
                      <Tooltip title="Reset approved status to edit">
                        <Chip
                          label={S.unapprove}
                          size="small"
                          onClick={(e) => handleUnapproveGroup(e, group)}
                          sx={{
                            height: 20,
                            fontSize: '0.6875rem',
                            fontWeight: 600,
                            bgcolor: 'var(--status-approved-bg)',
                            color: 'var(--status-approved-text)',
                            border: '1px solid',
                            borderColor: 'var(--status-approved-border)',
                            cursor: 'pointer',
                          }}
                        />
                      </Tooltip>
                    ) : group.status !== 'empty' && (
                      <Tooltip
                        title={
                          !canApprove
                            ? (group.gaps.length > 0 ? `Missing: ${group.gaps.join(' · ')}` : 'Resolve checks before approving')
                            : 'Approve section'
                        }
                      >
                        <Box component="span" tabIndex={0} sx={{ display: 'inline-block' }}>
                          <Button
                            size="small"
                            variant="text"
                            aria-disabled={!canApprove || busy}
                            onClick={(e) => {
                              if (!canApprove || busy) {
                                e.stopPropagation();
                                return;
                              }
                              handleApproveGroup(e, group);
                            }}
                            sx={{
                              fontSize: '0.6875rem',
                              py: 0.2,
                              px: 0.8,
                              minWidth: 0,
                              color: canApprove ? 'primary.main' : 'text.disabled',
                              cursor: canApprove ? 'pointer' : 'not-allowed',
                              '&:hover': { bgcolor: canApprove ? 'action.hover' : 'transparent' },
                            }}
                          >
                            {S.approve}
                          </Button>
                        </Box>
                      </Tooltip>
                    )}
                  </Box>
                )}
              </ListItemButton>
            </Tooltip>
          );
        })}
      </List>

      {/* Модальне підтвердження скидання статусу */}
      <Dialog
        open={Boolean(confirmGroup)}
        onClose={() => setConfirmGroup(null)}
        PaperProps={{ sx: { maxWidth: 400, p: 1 } }}
      >
        <DialogTitle sx={{ fontSize: '1rem', fontWeight: 600 }}>
          Reset approval status?
        </DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ fontSize: '0.875rem' }}>
            Editing this approved section will return its status to &quot;Needs review&quot;. You can approve it again after revising.
          </DialogContentText>
        </DialogContent>
        <DialogActions sx={{ pb: 1.5, px: 2 }}>
          <Button onClick={() => setConfirmGroup(null)} color="inherit" size="small">
            Cancel
          </Button>
          <Button onClick={confirmUnapprove} variant="contained" color="warning" size="small">
            Continue &amp; Reset
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default SyllabusStructurePanel;
