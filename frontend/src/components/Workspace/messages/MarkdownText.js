import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Box from '@mui/material/Box';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';

const markdownComponents = {
  p: ({ children }) => (
    <Typography component="p" variant="body2" sx={{ mb: 0.75, '&:last-child': { mb: 0 } }}>
      {children}
    </Typography>
  ),
  li: ({ children }) => (
    <Typography component="li" variant="body2" sx={{ mb: 0.25 }}>
      {children}
    </Typography>
  ),
  strong: ({ children }) => <Box component="strong" sx={{ fontWeight: 700 }}>{children}</Box>,
  a: ({ href, children }) => (
    <Link href={href} target="_blank" rel="noreferrer" color="inherit" underline="hover">
      {children}
    </Link>
  ),
  table: ({ children }) => (
    <Box sx={{ maxWidth: '100%', overflowX: 'auto', my: 1 }}>
      <Box
        component="table"
        sx={{
          width: '100%',
          minWidth: 420,
          borderCollapse: 'collapse',
          fontSize: '0.875rem',
        }}
      >
        {children}
      </Box>
    </Box>
  ),
  thead: ({ children }) => <Box component="thead" sx={{ bgcolor: 'action.hover' }}>{children}</Box>,
  tbody: ({ children }) => <tbody>{children}</tbody>,
  tr: ({ children }) => <tr>{children}</tr>,
  th: ({ children }) => (
    <Box component="th" sx={{ border: '1px solid', borderColor: 'divider', p: 0.75, textAlign: 'left', fontWeight: 700 }}>
      {children}
    </Box>
  ),
  td: ({ children }) => (
    <Box component="td" sx={{ border: '1px solid', borderColor: 'divider', p: 0.75, verticalAlign: 'top' }}>
      {children}
    </Box>
  ),
};

function looksLikeTableRow(line) {
  const trimmed = String(line || '').trim();
  return trimmed.startsWith('|') && trimmed.endsWith('|') && trimmed.split('|').length >= 4;
}

function looksLikeTableDivider(line) {
  const trimmed = String(line || '').trim();
  if (!looksLikeTableRow(trimmed)) return false;
  return trimmed
    .slice(1, -1)
    .split('|')
    .every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

function normalizeMarkdownTables(value) {
  const lines = String(value || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const out = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const startsTable = looksLikeTableRow(line) && looksLikeTableDivider(lines[index + 1]);
    if (startsTable && out.length && out[out.length - 1].trim()) {
      out.push('');
    }
    out.push(line);
    const inTable = looksLikeTableRow(line) || looksLikeTableDivider(line);
    const nextLeavesTable = inTable && lines[index + 1] && !looksLikeTableRow(lines[index + 1]) && lines[index + 1].trim();
    if (nextLeavesTable) {
      out.push('');
    }
  }
  return out.join('\n');
}

export const MarkdownText = ({ children, sx }) => (
  <Box
    sx={{
      overflowWrap: 'anywhere',
      '& ul, & ol': { pl: 2.5, my: 0.75 },
      '& h1, & h2, & h3, & h4': {
        fontSize: '1rem',
        lineHeight: 1.35,
        fontWeight: 700,
        mt: 1,
        mb: 0.5,
      },
      '& code': {
        px: 0.4,
        py: 0.1,
        borderRadius: 0,
        bgcolor: 'action.hover',
        fontFamily: 'monospace',
      },
      '& table': {
        tableLayout: 'auto',
      },
      ...sx,
    }}
  >
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
      {normalizeMarkdownTables(children)}
    </ReactMarkdown>
  </Box>
);

export default MarkdownText;
