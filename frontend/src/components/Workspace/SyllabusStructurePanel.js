import React from 'react';
import { Box, Button, LinearProgress, List, ListItemButton, Typography, Tooltip } from '@mui/material';
import { computeGroupedReadiness } from '../../utils/sectionGroups';
import { useWorkspaceChrome } from '../../contexts/WorkspaceChromeContext';

const STATUS = { approved: ['var(--ok)', 'approved'], attention: ['var(--flag)', 'needs attention'], needs_review: ['var(--wip)', 'needs review'], empty: ['var(--line)', 'empty'] };
const SyllabusStructurePanel = ({ readiness, state = {}, focusedKey, onSelect }) => {
  const grouped = computeGroupedReadiness(readiness, state);
  const { chrome } = useWorkspaceChrome();
  return <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', bgcolor: 'background.paper', borderRight: '1px solid', borderColor: 'divider' }}>
    <List aria-label="Syllabus sections" sx={{ flex: 1, overflowY: 'auto', py: 1.5 }}>
      {grouped.groups.map(group => {
        const [color, status] = STATUS[group.status] || STATUS.empty;
        return <Tooltip key={group.id} title={group.gaps?.join(' · ') || status} placement="right"><ListItemButton selected={group.backendKeys.includes(focusedKey)} onClick={() => onSelect?.(group.backendKeys[0])} aria-label={`${group.title} — ${status}`} sx={{ px: 2, py: 1.25, gap: 1.5 }}><Box className="status-dot" sx={{ bgcolor: color }} aria-hidden="true" /><Typography sx={{ fontSize: 13, color: 'text.secondary', fontWeight: group.backendKeys.includes(focusedKey) ? 700 : 400 }}>{group.title}</Typography></ListItemButton></Tooltip>;
      })}
    </List>
    <Box sx={{ p: 2, borderTop: '1px solid', borderColor: 'divider', position: 'relative' }}>
      <Box className="raster" aria-hidden="true" sx={{ position: 'absolute', inset: 0, opacity: .4, maskImage: 'linear-gradient(black, transparent 75%)', pointerEvents: 'none' }} />
      <Box sx={{ position: 'relative' }}>
        <Box sx={{ display: 'flex', mb: 1.25 }}><Box className="brand-plate">Readiness</Box><Typography sx={{ bgcolor: 'background.paper', px: 1.5, py: .5, border: '1px solid', borderColor: 'divider', fontWeight: 700 }}>{grouped.isEmpty ? '—' : `${grouped.percent}%`}</Typography></Box>
        <LinearProgress variant="determinate" value={grouped.percent || 0} aria-label="Readiness" sx={{ height: 6, mb: .75 }} />
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: chrome?.openChecks > 0 ? 1 : 0 }}>{grouped.isEmpty ? 'No document yet' : `${grouped.approvedCount} of ${grouped.totalCount} approved`}</Typography>
        {chrome?.openChecks > 0 && <Button fullWidth color="error" onClick={chrome.onFocusCheck} sx={{ mt: .5, fontSize: 12 }}>{chrome.openChecks} checks open</Button>}
      </Box>
    </Box>
  </Box>;
};
export default SyllabusStructurePanel;
