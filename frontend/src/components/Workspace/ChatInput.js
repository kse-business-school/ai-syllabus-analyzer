import React, { useState } from 'react';
import Box from '@mui/material/Box';
import TextField from '@mui/material/TextField';
import IconButton from '@mui/material/IconButton';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { S } from '../../strings';
import ArrowUpward from '@mui/icons-material/ArrowUpward';
import StopCircleOutlined from '@mui/icons-material/StopCircleOutlined';

const ChatInput = ({ onSend, onStop, disabled, readOnly = false, placeholder }) => {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  const submit = async () => {
    const trimmed = text.trim();
    if (!trimmed || sending || readOnly) return;
    setSending(true);
    try {
      // onSend повертає false при помилці чи Stop — тоді текст лишається в полі.
      const ok = await onSend(trimmed);
      if (ok !== false) setText('');
    } finally {
      setSending(false);
    }
  };

  const isDisabled = disabled || readOnly || sending;

  return (
    <Box sx={{ p: 2, pb: 1, borderTop: '1px solid', borderColor: 'divider', bgcolor: 'background.paper' }}>
      <Box sx={{ display: 'flex', gap: 0, alignItems: 'flex-end' }}>
        <TextField
          fullWidth
          size="small"
          multiline
          maxRows={4}
          placeholder={readOnly ? S.readOnlyNotice : placeholder || S.chatPlaceholder}
          value={text}
          disabled={isDisabled}
          onChange={(e) => setText(e.target.value)}
          inputProps={{ 'aria-label': placeholder || S.chatPlaceholder }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        {sending && onStop ? (
          <Button
            variant="outlined"
            size="small"
            color="inherit"
            startIcon={<StopCircleOutlined />}
            onClick={onStop}
            sx={{ flexShrink: 0, height: 40 }}
          >
            {S.stop}
          </Button>
        ) : (
          <IconButton color="primary" aria-label={S.send} onClick={submit} disabled={isDisabled || !text.trim()} sx={{ width: 40, height: 40, bgcolor: 'primary.main', color: 'primary.contrastText', '&:hover': { bgcolor: 'primary.dark' } }}>
            <ArrowUpward sx={{ fontSize: 20 }} />
          </IconButton>
        )}
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
        {readOnly ? S.readOnlyNotice : S.chatCaption}
      </Typography>
    </Box>
  );
};

export default ChatInput;
