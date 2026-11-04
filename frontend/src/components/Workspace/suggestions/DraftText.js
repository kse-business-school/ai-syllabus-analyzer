import React, { useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import InputBase from '@mui/material/InputBase';
import Tooltip from '@mui/material/Tooltip';
import { alpha, useTheme } from '@mui/material/styles';
import Check from '@mui/icons-material/Check';
import Close from '@mui/icons-material/Close';

// Розбиває текст чернетки на шматки: звичайний текст і proposedValues.
// З template — за плейсхолдерами {{id}}; без нього — підсвічуємо кожне входження значення.
export function splitDraft(text, template, values = []) {
  const byId = new Map(values.map((v) => [v.id, v]));
  if (template) {
    return String(template).split(/(\{\{\w+\}\})/).filter(Boolean).map((chunk) => {
      const m = /^\{\{(\w+)\}\}$/.exec(chunk);
      const v = m && byId.get(m[1]);
      return v ? { value: v } : { text: chunk };
    });
  }
  let chunks = [{ text: String(text || '') }];
  [...values].sort((a, b) => String(b.value).length - String(a.value).length).forEach((v) => {
    if (v.value == null || v.value === '') return;
    const needle = String(v.value);
    chunks = chunks.flatMap((chunk) => {
      if (chunk.value) return [chunk];
      return chunk.text.split(needle).flatMap((text, i) => i === 0 ? [{ text }] : [{ value: v }, { text }]);
    });
  });
  return chunks;
}

const InlineEditor = ({ initial, label, busy, onSave, onCancel }) => {
  const [draft, setDraft] = useState(String(initial ?? ''));
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  const save = () => {
    const trimmed = draft.trim();
    if (trimmed) onSave(trimmed);
  };
  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25, verticalAlign: 'middle' }}>
      <InputBase
        inputRef={ref}
        value={draft}
        disabled={busy}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); save(); }
          if (e.key === 'Escape') onCancel();
        }}
        inputProps={{ 'aria-label': label, size: Math.max(4, draft.length + 1) }}
        sx={{
          px: 0.75,
          border: '1px solid',
          borderColor: 'warning.main',
          borderRadius: 0,
          fontSize: 'inherit',
          lineHeight: 1.4,
          bgcolor: 'background.paper',
        }}
      />
      <Tooltip title="Save">
        <span>
          <IconButton size="small" aria-label="Save value" disabled={busy || !draft.trim()} onClick={save}><Check fontSize="inherit" /></IconButton>
        </span>
      </Tooltip>
      <Tooltip title="Cancel">
        <IconButton size="small" aria-label="Cancel editing" disabled={busy} onClick={onCancel}><Close fontSize="inherit" /></IconButton>
      </Tooltip>
    </Box>
  );
};

// Текст чернетки з підсвіченими proposedValues. Непідтверджені — акцентний фон, підтверджені — рамка primary.
// editingId — значення, яке зараз редагується інлайн; onEdit(id) / onSave(id, value) / onCancel.
const DraftText = ({ text, template, values = [], editable = false, editingId = null, busy, onEdit, onSave, onCancel, sx }) => {
  const theme = useTheme();
  const accent = theme.palette.warning.main;
  const chunks = splitDraft(text, template, values);
  return (
    <Box component="div" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', typography: 'body2', lineHeight: 1.7, ...sx }}>
      {chunks.map((c, i) => {
        if (!c.value) {
          // eslint-disable-next-line react/no-array-index-key
          return <span key={`t-${i}`}>{c.text}</span>;
        }
        const v = c.value;
        if (editingId === v.id) {
          return <InlineEditor key={`e-${v.id}`} initial={v.value} label={v.label || 'Value'} busy={busy} onSave={(val) => onSave(v.id, val)} onCancel={onCancel} />;
        }
        return (
          <Tooltip key={`v-${v.id}-${i}`} title={`${v.label || 'Proposed value'}${v.confirmed ? ' · confirmed' : ' · suggested by AI'}${editable ? ' · click to change' : ''}`}>
            <Box
              component="mark"
              role={editable ? 'button' : undefined}
              tabIndex={editable ? 0 : undefined}
              onClick={editable ? () => onEdit(v.id) : undefined}
              onKeyDown={editable ? (e) => { if (e.key === 'Enter') onEdit(v.id); } : undefined}
              sx={{
                color: 'inherit',
                px: 0.5,
                py: 0.1,
                borderRadius: 0,
                fontWeight: 600,
                cursor: editable ? 'pointer' : 'default',
                bgcolor: v.confirmed ? 'transparent' : alpha(accent, theme.palette.mode === 'dark' ? 0.3 : 0.18),
                border: '1px solid',
                borderColor: v.confirmed ? 'primary.main' : alpha(accent, 0.6),
              }}
            >
              {v.value}
            </Box>
          </Tooltip>
        );
      })}
    </Box>
  );
};

export default DraftText;
