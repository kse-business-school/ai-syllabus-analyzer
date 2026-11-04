import React, { useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Collapse from '@mui/material/Collapse';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Check from '@mui/icons-material/Check';
import Close from '@mui/icons-material/Close';
import Edit from '@mui/icons-material/Edit';
import ExpandLess from '@mui/icons-material/ExpandLess';
import ExpandMore from '@mui/icons-material/ExpandMore';
import Undo from '@mui/icons-material/Undo';
import RejectDialog from './RejectDialog';
import RefineDialog from './RefineDialog';
import { REJECT_TAGS, SEVERITY, S } from '../../../strings';

const tagLabel = (value) => REJECT_TAGS.find((t) => t.value === value)?.label || null;

const ResolvedSummary = ({ suggestion }) => {
  const accepted = suggestion.status === 'accepted';
  const selected = suggestion.options?.find((o) => o.id === suggestion.selectedOptionId);
  const tag = tagLabel(suggestion.rejectTag);
  return (
    <Stack spacing={0.5} sx={{ mt: 0.5 }}>
      <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap">
        <Chip
          size="small"
          color={accepted ? 'primary' : 'default'}
          icon={accepted ? <Check /> : <Close />}
          label={accepted ? S.confirmed : S.cancelled}
        />
        {accepted && selected && (
          <Typography variant="caption" color="text.secondary">{S.chosenOption}: {selected.label}</Typography>
        )}
        {!accepted && tag && <Chip size="small" variant="outlined" label={tag} />}
      </Stack>
      {suggestion.decisionReason && (
        <Typography variant="body2" color="text.secondary">{S.reason}: {suggestion.decisionReason}</Typography>
      )}
    </Stack>
  );
};

// Спільна оболонка картки пропозиції v5: чипи, заголовок, дії (Confirm / Reword / Cancel / Undo), діалоги.
// Тіло (before/after, варіанти, поле відповіді) передається як children; головна дія — primary.
const SuggestionFrame = ({
  suggestion,
  sectionTitle = null,
  actions,
  busy = false,
  readOnly = false,
  highlighted = false,
  primary = null, // { label, icon, disabled, onClick } — onClick повертає { ok, error }
  secondary = null, // додаткові кнопки поруч із primary (Change the value)
  hideReword = false,
  error: externalError = '',
  onClearError,
  children,
}) => {
  const s = suggestion;
  const resolved = s.status !== 'pending';
  const severity = SEVERITY[s.severity] || SEVERITY.medium;
  const advisory = s.applicable === false && s.kind !== 'question';
  const requiresReason = s.requiresReason ?? ['critical', 'high'].includes(s.severity);

  const [expanded, setExpanded] = useState(!resolved);
  const [dialog, setDialog] = useState(null); // 'reject' | 'refine'
  const [error, setError] = useState('');

  useEffect(() => {
    setExpanded(s.status === 'pending');
  }, [s.status]);

  // Виконує дію; закриває діалог лише при успіху.
  const exec = async (fn) => {
    setError('');
    onClearError?.();
    const result = await fn();
    if (result?.ok) {
      setDialog(null);
      return true;
    }
    setError(result?.error || S.errAction);
    return false;
  };

  const closeDialog = () => { setDialog(null); setError(''); };
  const canAct = !readOnly && !resolved;
  const shownError = error || externalError;

  // Вирішена картка згорнута в один рядок історії; клік розгортає повну картку.
  if (resolved && !expanded) {
    const accepted = s.status === 'accepted';
    return (
      <Box
        id={`suggestion-${s.id}`}
        role="button"
        tabIndex={0}
        onClick={() => setExpanded(true)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(true); } }}
        sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.75, mb: 0.5, cursor: 'pointer', color: 'text.secondary', '&:hover': { color: 'text.primary' } }}
      >
        {accepted ? <Check fontSize="small" /> : <Close fontSize="small" />}
        <Typography variant="body2" noWrap sx={{ flexGrow: 1, minWidth: 0 }}>
          {accepted ? S.confirmed : S.cancelled}: {s.title}
        </Typography>
        <ExpandMore fontSize="small" />
      </Box>
    );
  }

  return (
    <Paper
      id={`suggestion-${s.id}`}
      variant="outlined"
      sx={{
        mb: 1.5,
        p: 2,
        maxWidth: '100%',
        borderLeft: '4px solid',
        borderLeftColor: resolved ? 'divider' : `${severity.color === 'default' ? 'grey.500' : `${severity.color}.main`}`,
        outline: highlighted ? '2px solid' : '2px solid transparent',
        outlineColor: highlighted ? 'primary.main' : 'transparent',
        transition: 'outline-color 0.3s',
      }}
    >
      <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap" sx={{ mb: 1 }}>
        <Chip size="small" color={severity.color} variant={severity.color === 'default' ? 'outlined' : 'filled'} label={severity.label} />
        {sectionTitle && <Chip size="small" variant="outlined" label={sectionTitle} sx={{ maxWidth: 260 }} />}
        {s.kind === 'question' && <Chip size="small" variant="outlined" color="primary" label={S.question} />}
        {advisory && <Chip size="small" variant="outlined" label={S.advisory} />}
        {resolved && (
          <IconButton
            size="small"
            sx={{ ml: 'auto' }}
            aria-label={expanded ? 'Collapse' : 'Expand'}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? <ExpandLess /> : <ExpandMore />}
          </IconButton>
        )}
      </Stack>

      <Typography variant="subtitle1" sx={{ fontWeight: 600, lineHeight: 1.35 }}>{s.title}</Typography>
      {resolved && <ResolvedSummary suggestion={s} />}

      <Collapse in={expanded} unmountOnExit>
        {s.description && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 1.5, whiteSpace: 'pre-wrap' }}>
            {s.description}
          </Typography>
        )}
        {s.stale && !resolved && (
          <Alert
            severity="warning"
            sx={{ mb: 1.5 }}
            action={!readOnly && (
              <Button color="inherit" size="small" disabled={busy} onClick={() => exec(() => actions.refine(s.id, { comment: 'Draft this again for the current text of the section.' }))}>
                {S.draftAgain}
              </Button>
            )}
          >
            {S.staleDraft}
          </Alert>
        )}
        {children}
      </Collapse>

      {shownError && !dialog && (
        <Alert severity="error" sx={{ mt: 1.5 }} onClose={() => { setError(''); onClearError?.(); }}>{shownError}</Alert>
      )}

      {canAct && (
        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mt: 1.5 }}>
          {advisory ? (
            <Button variant="contained" size="small" startIcon={<Check />} disabled={busy} onClick={() => exec(() => actions.confirm(s.id))}>
              {S.gotIt}
            </Button>
          ) : primary && (
            <Button
              variant="contained"
              size="small"
              startIcon={primary.icon || <Check />}
              disabled={busy || primary.disabled || s.stale}
              onClick={() => exec(primary.onClick)}
            >
              {primary.label}
            </Button>
          )}
          {!advisory && secondary}
          {!hideReword && !advisory && (
            <Button variant="outlined" size="small" startIcon={<Edit />} disabled={busy} onClick={() => setDialog('refine')}>
              {S.reword}
            </Button>
          )}
          <Button variant="text" size="small" color="inherit" startIcon={<Close />} disabled={busy} onClick={() => setDialog('reject')}>
            {S.cancel}
          </Button>
        </Stack>
      )}

      {!readOnly && resolved && (
        <Box sx={{ mt: 1 }}>
          <Button size="small" variant="text" startIcon={<Undo />} disabled={busy} onClick={() => exec(() => actions.reopen(s.id))}>
            {S.undo}
          </Button>
        </Box>
      )}

      <RejectDialog
        open={dialog === 'reject'}
        requiresReason={requiresReason}
        busy={busy}
        error={dialog === 'reject' ? error : ''}
        onClose={closeDialog}
        onSubmit={(body) => exec(() => actions.reject(s.id, body))}
      />
      <RefineDialog
        open={dialog === 'refine'}
        busy={busy}
        error={dialog === 'refine' ? error : ''}
        onClose={closeDialog}
        onSubmit={(body) => exec(() => actions.refine(s.id, body))}
      />
    </Paper>
  );
};

export default SuggestionFrame;
