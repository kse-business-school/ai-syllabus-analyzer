import React from 'react';
import Box from '@mui/material/Box';

/**
 * Computes simple word-based diff parts if before and after strings are passed.
 */
function computeWordDiff(before = '', after = '') {
  if (!before) return [{ type: 'ins', text: after }];
  if (!after) return [{ type: 'del', text: before }];

  const bWords = before.split(/(\s+)/);
  const aWords = after.split(/(\s+)/);

  // Simple heuristic: compare tokens
  const parts = [];
  let i = 0;
  let j = 0;

  while (i < bWords.length || j < aWords.length) {
    if (i < bWords.length && j < aWords.length && bWords[i] === aWords[j]) {
      parts.push({ type: 'eq', text: bWords[i] });
      i += 1;
      j += 1;
    } else {
      if (i < bWords.length) {
        parts.push({ type: 'del', text: bWords[i] });
        i += 1;
      }
      if (j < aWords.length) {
        parts.push({ type: 'ins', text: aWords[j] });
        j += 1;
      }
    }
  }
  return parts;
}

const DiffText = ({ parts, before, after, force, sx }) => {
  const resolvedParts = parts || computeWordDiff(before, after);

  return (
    <Box component="span" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', ...sx }}>
      {resolvedParts.map((part, index) => {
        const type = force || part.type;
        if (type === 'del') {
          return (
            <Box
              // eslint-disable-next-line react/no-array-index-key
              key={`del-${index}`}
              component="s"
              sx={{
                bgcolor: 'var(--diff-del-bg)',
                color: 'var(--diff-del-fg)',
                textDecoration: 'line-through',
                px: 0.35,
                py: 0.1,
                borderRadius: 0,
                mr: 0.25,
                display: 'inline-block',
                '&::before': { content: '"− "' },
              }}
            >
              {part.text}
            </Box>
          );
        }
        if (type === 'ins') {
          return (
            <Box
              // eslint-disable-next-line react/no-array-index-key
              key={`ins-${index}`}
              component="ins"
              sx={{
                bgcolor: 'var(--diff-add-bg)',
                color: 'var(--diff-add-fg)',
                textDecoration: 'none',
                px: 0.35,
                py: 0.1,
                borderRadius: 0,
                mr: 0.25,
                display: 'inline-block',
                fontWeight: 500,
                '&::before': { content: '"+ "' },
              }}
            >
              {part.text}
            </Box>
          );
        }
        return (
          // eslint-disable-next-line react/no-array-index-key
          <span key={`eq-${index}`}>{part.text}</span>
        );
      })}
    </Box>
  );
};

export default DiffText;
