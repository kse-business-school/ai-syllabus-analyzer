import React, { useEffect, useState } from 'react';
import CircularProgress from '@mui/material/CircularProgress';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Bubble from './Bubble';
import { S } from '../../../strings';

const PendingReply = () => {
  const [isLongWait, setIsLongWait] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsLongWait(true);
    }, 25000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <Bubble role="ai">
      <Stack direction="row" spacing={1.5} alignItems="center">
        <CircularProgress size={16} thickness={4} sx={{ color: 'primary.main' }} />
        <Typography variant="body2" sx={{ color: 'text.secondary', fontSize: '0.8125rem' }}>
          {isLongWait ? S.thinkingLong : S.thinking}
        </Typography>
      </Stack>
    </Bubble>
  );
};

export default PendingReply;
