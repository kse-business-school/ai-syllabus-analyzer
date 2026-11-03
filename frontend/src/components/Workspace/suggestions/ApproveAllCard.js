import React, { useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Collapse from '@mui/material/Collapse';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import CheckCircle from '@mui/icons-material/CheckCircle';
import DoneAll from '@mui/icons-material/DoneAll';
import ExpandLess from '@mui/icons-material/ExpandLess';
import ExpandMore from '@mui/icons-material/ExpandMore';
import RadioButtonUnchecked from '@mui/icons-material/RadioButtonUnchecked';
import DocumentBlocks from '../document/DocumentBlocks';
import { S } from '../../../strings';

const sectionLabel = (sec, key) => {
  if (!sec) return key;
  return sec.docNumber ? `${sec.docNumber} · ${sec.title}` : sec.title;
};

// Повідомлення kind='approve-all' { sections: [key] }: «N sections need no changes» + Approve all.
// Кожен розділ можна розкрити (текст з правої панелі) і затвердити окремо.
const ApproveAllCard = ({ sectionKeys = [], sections = [], readiness, documentSections = [], actions, busy, readOnly }) => {
  const [open, setOpen] = useState({});
  const [expandedCard, setExpandedCard] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const byKey = new Map(sections.map((s) => [s.key, s]));
  const docByKey = new Map((documentSections || []).map((s) => [s.key, s]));
  const isApproved = (key) => !!readiness?.sections?.[key]?.approved;
  const remaining = sectionKeys.filter((k) => !isApproved(k));

  const exec = async (fn) => {
    setError('');
    const res = await fn();
    if (!res?.ok) setError(res?.error || S.errAction);
    return res;
  };

  const approveAll = async () => {
    const res = await exec(() => actions.approveAll(remaining));
    if (res?.ok) setResult({ approved: res.data?.approved || [], skipped: res.data?.skipped || [] });
  };

  if (remaining.length === 0 && !result?.skipped?.length && !expandedCard) {
    return (
      <Stack
        direction="row"
        spacing={1}
        alignItems="center"
        sx={{ mb: 1, py: 0.75, px: 1.5, borderRadius: 1, bgcolor: 'action.hover' }}
      >
        <CheckCircle fontSize="small" color="primary" />
        <Typography variant="body2" sx={{ flexGrow: 1, minWidth: 0 }} noWrap>
          {S.noChangesTitle(sectionKeys.length)}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
          {S.approved}
        </Typography>
        <Button size="small" variant="text" color="inherit" onClick={() => setExpandedCard(true)} sx={{ minWidth: 0, px: 0.75 }}>
          Show
        </Button>
      </Stack>
    );
  }

  return (
    <Paper variant="outlined" sx={{ mb: 1.5, p: 2, borderLeft: '4px solid', borderLeftColor: remaining.length ? 'primary.main' : 'divider' }}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
        <DoneAll fontSize="small" color="primary" />
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>{S.noChangesTitle(sectionKeys.length)}</Typography>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>{S.noChangesHint}</Typography>

      <Box>
        {sectionKeys.map((key) => {
          const approved = isApproved(key);
          const expanded = !!open[key];
          const doc = docByKey.get(key);
          return (
            <Box key={key} sx={{ borderTop: '1px solid', borderColor: 'divider' }}>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ py: 0.75 }}>
                {approved ? <CheckCircle fontSize="small" color="primary" /> : <RadioButtonUnchecked fontSize="small" color="disabled" />}
                <Typography variant="body2" sx={{ flexGrow: 1, minWidth: 0 }} noWrap>{sectionLabel(byKey.get(key), key)}</Typography>
                {approved ? (
                  <Chip size="small" variant="outlined" color="primary" label={S.approved} />
                ) : !readOnly && (
                  <Button size="small" variant="text" disabled={busy} onClick={() => exec(() => actions.approveSection(key))}>
                    {S.approve}
                  </Button>
                )}
                <IconButton size="small" aria-label={expanded ? 'Hide section' : 'Show section'} onClick={() => setOpen((o) => ({ ...o, [key]: !o[key] }))}>
                  {expanded ? <ExpandLess fontSize="small" /> : <ExpandMore fontSize="small" />}
                </IconButton>
              </Stack>
              <Collapse in={expanded} unmountOnExit>
                <Box sx={{ pl: 4, pb: 1.5, pr: 1 }}>
                  {doc?.blocks?.length
                    ? <DocumentBlocks blocks={doc.blocks} />
                    : <Typography variant="body2" color="text.secondary">{S.documentEmpty}</Typography>}
                </Box>
              </Collapse>
            </Box>
          );
        })}
      </Box>

      {result?.skipped?.length > 0 && (
        <Alert severity="warning" sx={{ mt: 1.5 }}>
          {S.approveAllSkipped}
          {result.skipped.map((s) => (
            <Box key={s.key} component="div">{sectionLabel(byKey.get(s.key), s.key)}: {s.reason}</Box>
          ))}
        </Alert>
      )}
      {error && <Alert severity="error" sx={{ mt: 1.5 }} onClose={() => setError('')}>{error}</Alert>}

      {!readOnly && remaining.length > 0 && (
        <Button variant="contained" size="small" startIcon={<DoneAll />} disabled={busy} sx={{ mt: 1.5 }} onClick={approveAll}>
          {remaining.length === sectionKeys.length ? S.approveAll : `${S.approveAll} (${remaining.length})`}
        </Button>
      )}
    </Paper>
  );
};

export default ApproveAllCard;
