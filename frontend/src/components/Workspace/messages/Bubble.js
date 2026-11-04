import React from 'react';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';

const Bubble = ({ role, children, sx }) => {
  const isUser = role === 'user';
  return (
    <Box sx={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start', mb: 1.5 }}>
      <Paper
        elevation={0}
        sx={{
          maxWidth: isUser ? '88%' : '100%',
          p: 1.5,
          bgcolor: isUser ? 'var(--me)' : 'transparent',
          color: isUser ? 'var(--me-fg)' : 'text.primary',
          border: 'none',
          borderColor: 'divider',
          borderRadius: 0,
          ...sx,
        }}
      >
        {children}
      </Paper>
    </Box>
  );
};

export default Bubble;
