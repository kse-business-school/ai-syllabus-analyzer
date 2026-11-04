import React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import LockOutlined from '@mui/icons-material/LockOutlined';
import DiffText from '../diff/DiffText';

// Плейсхолдери рендера стану (backend/services/syllabusState/render.js)
const PLACEHOLDERS = new Set(['—', '[Choose an option]']);
const isPlaceholder = (text) => PLACEHOLDERS.has(String(text || '').trim());

const placeholderSx = { color: 'text.disabled', fontStyle: 'italic' };

// Вміст блоку: parts (diff=1) або текст; плейсхолдер — приглушений курсив
const Content = ({ block, diff }) => {
  if (diff && Array.isArray(block.parts) && block.parts.length) return <DiffText parts={block.parts} />;
  if (isPlaceholder(block.text)) return <Box component="span" sx={placeholderSx}>{block.text}</Box>;
  return <Box component="span" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{block.text}</Box>;
};

// Семантична таблиця для послідовних рядків table-row
const SemanticTable = ({ rows, diff, sectionKey }) => {
  if (!rows || rows.length === 0) return null;

  // Витягуємо клітинки з кожного рядка
  const parsedRows = rows.map((r) => {
    const rawCells = String(r.text || '').split(' | ');
    return {
      block: r,
      cells: rawCells,
    };
  });

  // Перевіримо, чи це таблиця оцінювання (має % ваги)
  let totalWeight = 0;
  let hasWeights = false;

  parsedRows.forEach(({ cells }) => {
    cells.forEach((c) => {
      const match = String(c).match(/(\d+)\s*%/);
      if (match) {
        hasWeights = true;
        totalWeight += parseInt(match[1], 10);
      }
    });
  });

  const headerCells = parsedRows[0]?.cells || [];
  const bodyRows = parsedRows.slice(1);

  return (
    <Box sx={{ my: 1.5, overflowX: 'auto' }}>
      <Box
        component="table"
        sx={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: '0.8125rem',
          fontVariantNumeric: 'tabular-nums',
          '& th, & td': {
            py: 0.75,
            px: 1.25,
            borderBottom: '1px solid',
            borderColor: 'divider',
            textAlign: 'left',
          },
          '& th': {
            fontWeight: 600,
            bgcolor: 'action.hover',
            color: 'text.primary',
          },
          '& tr:hover td': {
            bgcolor: 'action.hover',
          },
        }}
      >
        <thead>
          <tr>
            {headerCells.map((cell, idx) => (
              <th key={idx}>
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {bodyRows.map((rowObj, rIdx) => (
            <tr key={rIdx}>
              {rowObj.cells.map((cell, cIdx) => (
                <td key={cIdx} style={{ fontWeight: cIdx === 0 ? 500 : 400 }}>
                  {diff && rowObj.block.parts?.length ? (
                    <Content block={rowObj.block} diff={diff} />
                  ) : isPlaceholder(cell) ? (
                    <Box component="span" sx={placeholderSx}>{cell}</Box>
                  ) : (
                    cell
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {hasWeights && (
          <tfoot>
            <tr>
              <td style={{ fontWeight: 700 }}>Total</td>
              <td colSpan={Math.max(1, headerCells.length - 1)} style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                {totalWeight}% {totalWeight === 100 ? '✓' : '(Recommended: 100%)'}
              </td>
            </tr>
          </tfoot>
        )}
      </Box>
    </Box>
  );
};

// Блоки одного розділу правої панелі: heading | paragraph | list-item | table-row
const DocumentBlocks = ({
  blocks = [],
  diff = false,
  sectionKey = null,
  isLocked = false,
  onSlotChange = null,
  readOnly = false,
}) => {
  // Групуємо послідовні table-row блоки в єдині semantic tables
  const groupedElements = [];
  let currentTableRows = [];

  const flushTable = () => {
    if (currentTableRows.length > 0) {
      groupedElements.push({
        type: 'table',
        rows: [...currentTableRows],
      });
      currentTableRows = [];
    }
  };

  blocks.forEach((block, index) => {
    if (block.kind === 'table-row') {
      currentTableRows.push(block);
    } else {
      flushTable();
      groupedElements.push({
        type: 'block',
        block,
        index,
      });
    }
  });
  flushTable();

  return (
    <Box sx={{ typography: 'body2', lineHeight: 1.65 }}>
      {isLocked && (
        <Box sx={{ mb: 1.5, display: 'inline-flex', alignItems: 'center', gap: 0.5, bgcolor: 'action.hover', px: 1, py: 0.25, borderRadius: 0 }}>
          <LockOutlined sx={{ fontSize: 13, color: 'text.secondary' }} />
          <Typography variant="caption" color="text.secondary">
            Set by KSE policy
          </Typography>
        </Box>
      )}

      {groupedElements.map((el, i) => {
        if (el.type === 'table') {
          return <SemanticTable key={`tbl-${i}`} rows={el.rows} diff={diff} sectionKey={sectionKey} />;
        }

        const { block, index } = el;
        const key = `${block.kind}-${index}`;
        const canChange = !isLocked && !readOnly && onSlotChange && !isPlaceholder(block.text);

        switch (block.kind) {
          case 'heading':
            return (
              <Typography key={key} variant="subtitle2" sx={{ mt: 1.5, mb: 0.5, fontWeight: 600 }}>
                <Content block={block} diff={diff} />
              </Typography>
            );
          case 'list-item':
            return (
              <Box
                key={key}
                sx={{
                  display: 'flex',
                  gap: 1,
                  mb: 0.5,
                  alignItems: 'baseline',
                  position: 'relative',
                  '&:hover .change-action, &:focus-within .change-action': {
                    opacity: 1,
                  },
                }}
              >
                <Box component="span" sx={{ color: 'text.secondary', userSelect: 'none' }}>•</Box>
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Content block={block} diff={diff} />
                </Box>
                {canChange && (
                  <Button
                    size="small"
                    variant="text"
                    className="change-action"
                    onClick={() => onSlotChange(block.slotKey || sectionKey, block.text)}
                    sx={{
                      opacity: 0,
                      transition: 'opacity 0.15s ease',
                      fontSize: '0.6875rem',
                      py: 0,
                      px: 0.5,
                      minWidth: 0,
                      color: 'text.secondary',
                      '&:hover': { color: 'primary.main' },
                    }}
                  >
                    Change this
                  </Button>
                )}
              </Box>
            );
          default:
            return (
              <Box
                key={key}
                sx={{
                  mb: 1,
                  position: 'relative',
                  display: 'flex',
                  alignItems: 'baseline',
                  justifyContent: 'space-between',
                  gap: 1,
                  '&:hover .change-action, &:focus-within .change-action': {
                    opacity: 1,
                  },
                }}
              >
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Content block={block} diff={diff} />
                </Box>
                {canChange && (
                  <Button
                    size="small"
                    variant="text"
                    className="change-action"
                    onClick={() => onSlotChange(block.slotKey || sectionKey, block.text)}
                    sx={{
                      opacity: 0,
                      transition: 'opacity 0.15s ease',
                      fontSize: '0.6875rem',
                      py: 0,
                      px: 0.5,
                      minWidth: 0,
                      color: 'text.secondary',
                      flexShrink: 0,
                      '&:hover': { color: 'primary.main' },
                    }}
                  >
                    Change this
                  </Button>
                )}
              </Box>
            );
        }
      })}
    </Box>
  );
};

export default DocumentBlocks;
