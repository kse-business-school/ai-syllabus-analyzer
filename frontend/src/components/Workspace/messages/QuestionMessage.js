import React, { useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import SkipNext from '@mui/icons-material/SkipNext';
import Bubble from './Bubble';
import MarkdownText from './MarkdownText';
import { S } from '../../../strings';

// Повідомлення kind='question' { slotKey, question, why, options }: одне питання інтерв'юера за раз.
// Блок `why` видимий одразу без додаткового кліку; quick-answer chips лише для коротких варіантів;
// Skip — тиха текстова дія.
const QuestionMessage = ({ payload, active = false, busy, readOnly, onSkip, onQuickAnswer }) => {
  const [error, setError] = useState('');
  if (!payload?.question) return null;

  const shortOptions = (payload.options || []).filter(
    (opt) => typeof opt === 'string' && opt.trim().length > 0 && opt.trim().length <= 40
  );

  const skip = async () => {
    setError('');
    const res = await onSkip(payload.slotKey);
    if (!res?.ok) setError(res?.error || S.errAction);
  };

  return (
    <Bubble role="ai" sx={{ borderColor: active ? 'primary.main' : 'divider' }}>
      {/* B-4.3: асистент називає розділ, до якого переходить */}
      {payload.nextSection && (
        <Typography variant="overline" color="text.secondary" sx={{ display: 'block', lineHeight: 1.6 }}>{payload.nextSection}</Typography>
      )}
      <MarkdownText>{payload.question}</MarkdownText>
      {payload.why && (
        <Box sx={{ mt: 1, p: 1, borderRadius: 0, bgcolor: 'action.hover' }}>
          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, display: 'block', mb: 0.25 }}>
            {S.whyWeAsk}
          </Typography>
          <Typography variant="body2" color="text.secondary">{payload.why}</Typography>
        </Box>
      )}
      {active && !readOnly && shortOptions.length > 0 && onQuickAnswer && (
        <Stack direction="row" spacing={0.75} sx={{ mt: 1 }} useFlexGap flexWrap="wrap">
          {shortOptions.map((opt) => (
            <Chip
              key={opt}
              label={opt}
              size="small"
              variant="outlined"
              clickable
              disabled={busy}
              onClick={() => onQuickAnswer(opt)}
            />
          ))}
        </Stack>
      )}
      {active && !readOnly && onSkip && payload.slotKey && (
        <Stack direction="row" spacing={1} sx={{ mt: 1 }} useFlexGap flexWrap="wrap">
          <Button size="small" variant="text" color="inherit" startIcon={<SkipNext />} disabled={busy} onClick={skip}>
            {S.skip}
          </Button>
        </Stack>
      )}
      {error && <Typography variant="caption" color="error" sx={{ display: 'block', mt: 0.5 }}>{error}</Typography>}
    </Bubble>
  );
};

export default QuestionMessage;
