import React, { useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import Check from '@mui/icons-material/Check';
import EditOutlined from '@mui/icons-material/EditOutlined';
import SuggestionFrame from './SuggestionFrame';
import DraftText from './DraftText';
import DiffText from '../diff/DiffText';
import valueText from './valueText';
import { S, confirmLabel } from '../../../strings';

const Label = ({ children }) => (
  <Typography variant="overline" color="text.secondary" sx={{ display: 'block', lineHeight: 1.6 }}>
    {children}
  </Typography>
);

// Чернетка: без вкладених рамок — Before приглушено, After основним текстом, між ними тонка лінія.
// Факти від моделі (proposedValues) підсвічені; Confirm називає їх, «Change the value» редагує одне значення.
const DraftCard = ({ suggestion, actions, busy, readOnly, ...frameProps }) => {
  const s = suggestion;
  const draft = s.draft || {};
  const pending = s.status === 'pending';
  const values = draft.proposedValues || [];
  const unconfirmed = values.filter((v) => !v.confirmed);

  const [showChanges, setShowChanges] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');

  const afterText = draft.text || valueText(draft.value);
  const beforeText = valueText(s.before);
  const canEdit = pending && !readOnly && !busy;

  const saveValue = async (valueId, value) => {
    setErrorMsg('');
    const res = await actions?.setValue?.(s.id, valueId, value);
    if (res?.ok) setEditingId(null);
    else setErrorMsg(res?.error || S.errAction);
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
        label: confirmLabel(unconfirmed),
        icon: <Check />,
        disabled: editingId != null,
        onClick: () => actions?.confirm?.(s.id),
      }}
      secondary={
        canEdit && unconfirmed.length > 0 && editingId == null ? (
          <Button
            variant="outlined"
            size="small"
            startIcon={<EditOutlined />}
            disabled={busy}
            onClick={() => setEditingId(unconfirmed[0].id)}
          >
            {S.changeValue}
          </Button>
        ) : null
      }
      {...frameProps}
    >
      {beforeText && (
        <Box sx={{ mb: 1.5 }}>
          <Label>{S.before}</Label>
          <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
            {beforeText}
          </Typography>
        </Box>
      )}

      <Box sx={{ pt: beforeText ? 1.5 : 0, borderTop: beforeText ? '1px solid' : 'none', borderColor: 'divider' }}>
        {beforeText && <Label>{S.after}</Label>}
        {showChanges && beforeText ? (
          <Box sx={{ fontSize: '0.875rem', lineHeight: 1.6 }}>
            <DiffText before={beforeText} after={afterText} />
          </Box>
        ) : (
          <DraftText
            text={afterText}
            template={draft.template}
            values={values}
            editable={canEdit && values.length > 0}
            editingId={editingId}
            busy={busy}
            onEdit={setEditingId}
            onSave={saveValue}
            onCancel={() => setEditingId(null)}
          />
        )}
        {beforeText && (
          <Button size="small" variant="text" color="inherit" sx={{ mt: 0.5, px: 0 }} onClick={() => setShowChanges((v) => !v)}>
            {showChanges ? 'Hide changes' : 'Show changes'}
          </Button>
        )}
      </Box>

      {pending && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
          {S.draftFooter}
        </Typography>
      )}
    </SuggestionFrame>
  );
};

export default DraftCard;
