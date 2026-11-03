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
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogActions from '@mui/material/DialogActions';
import CheckCircle from '@mui/icons-material/CheckCircle';
import WarningAmber from '@mui/icons-material/WarningAmber';
import RadioButtonUnchecked from '@mui/icons-material/RadioButtonUnchecked';
import AutoAwesomeOutlined from '@mui/icons-material/AutoAwesomeOutlined';
import EditOutlined from '@mui/icons-material/EditOutlined';
import { computeGroupedReadiness } from '../../utils/sectionGroups';
import { S } from '../../strings';

const STATUS_ICONS = {
  approved: <CheckCircle sx={{ fontSize: 16, color: 'success.main' }} />,
  attention: <WarningAmber sx={{ fontSize: 16, color: 'error.main' }} />,
  draft_in_chat: <AutoAwesomeOutlined sx={{ fontSize: 16, color: 'info.main' }} />,
  needs_review: <EditOutlined sx={{ fontSize: 16, color: 'warning.main' }} />,
  empty: <RadioButtonUnchecked sx={{ fontSize: 16, color: 'text.muted' }} />,
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
  const [errorMsg, setErrorMsg] = useState('');

  const handleGroupClick = (group) => {
    // Select the first backend key of the group
    onSelect?.(group.backendKeys[0]);
  };

  const handleApproveGroup = async (e, group) => {
    e.stopPropagation();
    setErrorMsg('');

    if (group.backendKeys.length > 1) {
      // Atomic multi-section approval for Summary & Outcomes
      const res = await actions?.approveAll(group.backendKeys);
      if (!res?.ok) {
        setErrorMsg(res?.error || 'Could not approve all subsections');
      } else if (res?.skipped && res.skipped.length > 0) {
        const reasons = res.skipped.map((s) => s.reason).join(', ');
        setErrorMsg(`Some subsections were skipped: ${reasons}`);
      }
    } else {
      const res = await actions?.approveSection(group.backendKeys[0]);
      if (!res?.ok) {
        setErrorMsg(res?.error || 'Could not approve section');
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
            {grouped.isEmpty ? '—' : `${grouped.percent}%`}
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
          {grouped.isEmpty ? 'New syllabus · 0 of 8 sections filled' : `${grouped.approvedCount} of ${grouped.totalCount} sections approved`}
        </Typography>

        {errorMsg && (
          <Typography variant="caption" sx={{ color: 'error.main', display: 'block', mt: 0.5, lineHeight: 1.2 }}>
            {errorMsg}
          </Typography>
        )}
      </Box>

      {/* Список 8 логічних секцій */}
      <List sx={{ flex: '1 1 auto', overflowY: 'auto', py: 1, px: 0.75 }}>
        {grouped.groups.map((group) => {
          const isSelected = group.backendKeys.includes(focusedKey);
          return (
            <ListItemButton
              key={group.id}
              onClick={() => handleGroupClick(group)}
              selected={isSelected}
              sx={{
                py: 0.85,
                px: 1.25,
                borderRadius: 1,
                mb: 0.5,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                transition: 'background-color 0.1s ease',
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 0, flex: 1 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
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
                </Box>
              </Box>

              {/* Дія для секції */}
              {!readOnly && (
                <Box sx={{ flexShrink: 0, ml: 1 }}>
                  {group.isApproved ? (
                    <Tooltip title="Reset approved status to edit">
                      <Chip
                        label="Approved"
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
                    <Button
                      size="small"
                      variant="text"
                      disabled={busy}
                      onClick={(e) => handleApproveGroup(e, group)}
                      sx={{
                        fontSize: '0.6875rem',
                        py: 0.2,
                        px: 0.8,
                        minWidth: 0,
                        color: 'primary.main',
                        '&:hover': { bgcolor: 'action.hover' },
                      }}
                    >
                      Approve
                    </Button>
                  )}
                </Box>
              )}
            </ListItemButton>
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
