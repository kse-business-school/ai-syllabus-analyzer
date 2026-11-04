import React, { useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Paper from '@mui/material/Paper';
import Radio from '@mui/material/Radio';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Check from '@mui/icons-material/Check';
import EditNote from '@mui/icons-material/EditNote';
import Gavel from '@mui/icons-material/Gavel';
import { S } from '../../../strings';

const OWN_SOURCES = ['instructor_directed', 'fixture_edited'];

// Повідомлення kind='policy-choice' { policyKey }: вибір варіанта довідника без дефолту + «Write my own».
// «Write my own» не відкриває порожнє поле — сервер переводить розмову на слот (POST /policies/:key/choose { writeOwn }).
// policy — запис довідника { key, title, rationale, options[{ key, label, text }] }; statePolicy — state.policies[i].
const PolicyChoiceCard = ({ policyKey, policy, statePolicy, actions, busy, readOnly, highlighted = false }) => {
  const options = policy?.options || [];
  const decidedOption = statePolicy?.optionKey ? options.find((o) => o.key === statePolicy.optionKey) : null;
  const ownText = OWN_SOURCES.includes(statePolicy?.source) && !statePolicy?.optionKey;
  const decided = !!statePolicy?.optionKey || ownText;
  const [selected, setSelected] = useState(null);
  const [changing, setChanging] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setSelected(null);
    setChanging(false);
  }, [statePolicy?.optionKey, statePolicy?.source]);

  const exec = async (fn) => {
    setError('');
    const result = await fn();
    if (!result?.ok) setError(result?.error || S.errAction);
  };

  const open = !decided || changing;
  const canAct = !readOnly && open;
  const parsedText = statePolicy?.source === 'parsed' ? statePolicy?.text : null;
  const title = policy?.title || policy?.name || policyKey;

  return (
    <Paper
      id={`policy-${policyKey}`}
      variant="outlined"
      sx={{
        mb: 1.5,
        p: 2,
        borderLeft: '4px solid',
        borderLeftColor: decided && !changing ? 'divider' : 'warning.main',
        outline: highlighted ? '2px solid' : '2px solid transparent',
        outlineColor: highlighted ? 'primary.main' : 'transparent',
      }}
    >
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
        <Gavel fontSize="small" color="action" />
        <Typography variant="overline" color="text.secondary">Course policy</Typography>
      </Stack>
      <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>{title}</Typography>
      {policy?.rationale && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>{policy.rationale}</Typography>
      )}

      {decided && !changing && (
        <Stack spacing={1} sx={{ mt: 1 }}>
          <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap">
            <Chip size="small" color="primary" icon={<Check />} label={statePolicy?.optionKey ? `${S.chosenOption}: ${decidedOption?.label || statePolicy.optionKey}` : S.customText} />
            {!readOnly && (
              <Button size="small" variant="text" disabled={busy} onClick={() => setChanging(true)}>Change</Button>
            )}
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'pre-wrap' }}>
            {statePolicy?.text || decidedOption?.text}
          </Typography>
        </Stack>
      )}

      {open && (
        <>
          {parsedText && (
            <Box sx={{ my: 1, p: 1.25, borderRadius: 1, bgcolor: 'action.hover' }}>
              <Typography variant="overline" color="text.secondary" sx={{ display: 'block', lineHeight: 1.6 }}>{S.yourCurrentText}</Typography>
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{parsedText}</Typography>
            </Box>
          )}
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>{S.chooseOption}</Typography>
          <Stack spacing={1}>
            {options.map((option) => {
              const isSelected = selected === option.key;
              const closest = statePolicy?.candidateOptionKey === option.key;
              return (
                <Box
                  key={option.key}
                  onClick={() => canAct && setSelected(option.key)}
                  sx={{
                    p: 1.25,
                    border: '1px solid',
                    borderColor: isSelected ? 'primary.main' : 'divider',
                    borderRadius: 1,
                    cursor: canAct ? 'pointer' : 'default',
                    bgcolor: isSelected ? 'action.selected' : 'transparent',
                  }}
                >
                  <Stack direction="row" spacing={0.5} alignItems="flex-start">
                    <Radio
                      size="small"
                      checked={isSelected}
                      disabled={!canAct}
                      onChange={() => setSelected(option.key)}
                      inputProps={{ 'aria-label': option.label }}
                      sx={{ mt: -0.5, ml: -0.75 }}
                    />
                    <Box sx={{ minWidth: 0 }}>
                      <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap">
                        <Typography variant="subtitle2">{option.label}</Typography>
                        {closest && <Chip size="small" variant="outlined" color="warning" label={S.closestMatch} />}
                      </Stack>
                      <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'pre-wrap' }}>{option.text}</Typography>
                    </Box>
                  </Stack>
                </Box>
              );
            })}
            {!options.length && <Typography variant="body2" color="text.secondary">{S.noOptions}</Typography>}
          </Stack>
          {error && <Alert severity="error" sx={{ mt: 1.5 }} onClose={() => setError('')}>{error}</Alert>}
          {canAct && (
            <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mt: 1.5 }}>
              <Button
                variant="contained"
                size="small"
                startIcon={<Check />}
                disabled={busy || !selected}
                onClick={() => exec(() => actions.choosePolicy(policyKey, selected))}
              >
                {S.confirmLabel}
              </Button>
              <Button
                variant="outlined"
                size="small"
                startIcon={<EditNote />}
                disabled={busy}
                onClick={() => exec(() => actions.writeOwnPolicy(policyKey))}
              >
                {S.writeOwnPolicy || S.writeOwn}
              </Button>
              {parsedText && <Button variant="outlined" size="small" disabled={busy} onClick={() => exec(() => actions.keepPolicyText(policyKey))}>Keep my text</Button>}
              {changing && (
                <Button variant="text" size="small" color="inherit" disabled={busy} onClick={() => setChanging(false)}>{S.back}</Button>
              )}
            </Stack>
          )}
        </>
      )}
    </Paper>
  );
};

export default PolicyChoiceCard;
