import React, { useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import ToggleButton from '@mui/material/ToggleButton';
import Check from '@mui/icons-material/Check';
import EditOutlined from '@mui/icons-material/EditOutlined';
import SuggestionFrame from './SuggestionFrame';
import DiffText from '../diff/DiffText';
import valueText from './valueText';
import { S } from '../../../strings';

const DraftCard = ({ suggestion, actions, busy, readOnly, ...frameProps }) => {
  const s = suggestion;
  const draft = s.draft || {};
  const pending = s.status === 'pending';
  const canAct = pending && !readOnly && !busy;

  const [viewMode, setViewMode] = useState('proposed'); // 'proposed' | 'compare'
  const [isEditingCustom, setIsEditingCustom] = useState(false);
  const [customText, setCustomText] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const afterText = valueText(draft.value);
  const beforeText = valueText(s.before);

  const startInlineEdit = () => {
    setCustomText(afterText);
    setIsEditingCustom(true);
  };

  const saveCustomEdit = async () => {
    setErrorMsg('');
    const res = await actions?.refine?.(s.id, { comment: `Use this exact text: ${customText}` });
    if (res?.ok) {
      setIsEditingCustom(false);
    } else {
      setErrorMsg(res?.error || 'Could not update draft');
    }
  };

  return (
    <SuggestionFrame
      suggestion={s}
      actions={actions}
      busy={busy}
      readOnly={readOnly}
      error={errorMsg}
      onClearError={() => setErrorMsg('')}
      primary={{
        label: 'Accept',
        icon: <Check />,
        disabled: isEditingCustom,
        onClick: () => actions?.confirm?.(s.id),
      }}
      secondary={
        canAct && !isEditingCustom ? (
          <Button
            variant="outlined"
            size="small"
            startIcon={<EditOutlined />}
            disabled={busy}
            onClick={startInlineEdit}
          >
            Edit text
          </Button>
        ) : null
      }
      {...frameProps}
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        {/* Перемикач Proposed text / Compare changes */}
        {beforeText && (
          <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
            <ToggleButtonGroup
              value={viewMode}
              exclusive
              size="small"
              onChange={(e, val) => val && setViewMode(val)}
              sx={{
                height: 24,
                bgcolor: 'background.default',
                borderRadius: 1,
                '& .MuiToggleButton-root': {
                  fontSize: '0.6875rem',
                  py: 0.2,
                  px: 1,
                  textTransform: 'none',
                  fontWeight: 500,
                  '&.Mui-selected': {
                    bgcolor: 'background.paper',
                    color: 'primary.main',
                    fontWeight: 600,
                  },
                },
              }}
            >
              <ToggleButton value="proposed">{S.proposedText}</ToggleButton>
              <ToggleButton value="compare">{S.showChanges}</ToggleButton>
            </ToggleButtonGroup>
          </Box>
        )}

        {/* Тіло відображення тексту або інлайн-редагування */}
        {isEditingCustom ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <TextField
              value={customText}
              onChange={(e) => setCustomText(e.target.value)}
              multiline
              rows={4}
              size="small"
              fullWidth
              autoFocus
              placeholder="Edit the proposed text directly…"
            />
            <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
              <Button
                size="small"
                variant="text"
                onClick={() => setIsEditingCustom(false)}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button
                size="small"
                variant="contained"
                onClick={saveCustomEdit}
                disabled={busy || !customText.trim()}
              >
                Save &amp; apply
              </Button>
            </Box>
          </Box>
        ) : viewMode === 'compare' && beforeText ? (
          <Box
            sx={{
              p: 1.5,
              borderRadius: 1,
              bgcolor: 'background.default',
              border: '1px solid',
              borderColor: 'divider',
              fontSize: '0.8125rem',
              lineHeight: 1.55,
            }}
          >
            <DiffText before={beforeText} after={afterText} />
          </Box>
        ) : (
          <Box
            sx={{
              p: 1.5,
              borderRadius: 1,
              bgcolor: 'background.default',
              border: '1px solid',
              borderColor: 'divider',
            }}
          >
            <Typography
              variant="body2"
              sx={{
                fontSize: '0.8125rem',
                lineHeight: 1.6,
                color: 'text.primary',
                whiteSpace: 'pre-wrap',
                overflowWrap: 'anywhere',
              }}
            >
              {afterText}
            </Typography>
          </Box>
        )}
      </Box>
    </SuggestionFrame>
  );
};

export default DraftCard;
