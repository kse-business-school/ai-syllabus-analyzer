import React from 'react';
import { Box, Button, LinearProgress, List, ListItemButton, Typography, Tooltip } from '@mui/material';
import { computeGroupedReadiness, sectionStatus, SECTION_STATUS_LABELS } from '../../utils/sectionGroups';
import { useWorkspaceChrome } from '../../contexts/WorkspaceChromeContext';

const STATUS = { approved: ['var(--ok)', 'approved'], attention: ['var(--flag)', 'needs attention'], needs_review: ['var(--wip)', 'needs review'], empty: ['var(--line)', 'empty'] };
// Розділ шаблону (B-5.3/B-5.4): «Ready to approve» — кільце кольору approved, без заливки
const SECTION_DOT = {
  approved: { bgcolor: 'var(--ok)' },
  ready: { bgcolor: 'transparent', border: '2px solid var(--ok)', boxSizing: 'border-box' },
  attention: { bgcolor: 'var(--flag)' },
  draft: { bgcolor: 'var(--wip)' },
  empty: { bgcolor: 'var(--line)' },
};
const SyllabusStructurePanel = ({ readiness, state = {}, sections = [], focusedKey, onSelect }) => {
  const grouped = computeGroupedReadiness(readiness, state, sections);
  const titleOf = (key) => { const t = sections.find((s) => s.key === key); return (state?.language === 'uk' && t?.titleUk) || t?.title || key; };
  const { chrome } = useWorkspaceChrome();
  return <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', bgcolor: 'background.paper', borderRight: '1px solid', borderColor: 'divider' }}>
    <List aria-label="Syllabus sections" sx={{ flex: 1, overflowY: 'auto', py: 1.5 }}>
      {grouped.groups.map(group => {
        const [color, status] = STATUS[group.status] || STATUS.empty;
        const single = group.backendKeys.length === 1 || group.isVirtualAi;
        const singleStatus = single && !group.isVirtualAi ? sectionStatus(readiness?.sections?.[group.backendKeys[0]]) : null;
        const label = singleStatus === 'ready' ? SECTION_STATUS_LABELS.ready : status;
        return <React.Fragment key={group.id}>
          <Tooltip title={group.gaps?.join(' · ') || label} placement="right"><ListItemButton selected={single && group.backendKeys.includes(focusedKey)} onClick={() => onSelect?.(group.backendKeys[0])} aria-label={`${group.title} — ${label}`} sx={{ px: 2, py: 1.25, gap: 1.5 }}><Box className="status-dot" sx={singleStatus ? SECTION_DOT[singleStatus] : { bgcolor: color }} aria-hidden="true" /><Typography sx={{ fontSize: 13, color: 'text.secondary', fontWeight: single && group.backendKeys.includes(focusedKey) ? 700 : 400 }}>{group.title}</Typography></ListItemButton></Tooltip>
          {/* Група з кількох розділів шаблону: кожен розділ — окремий рядок зі своїм статусом (одиниця Approve) */}
          {!single && group.backendKeys.map((key) => {
            const st = sectionStatus(readiness?.sections?.[key]);
            const gaps = readiness?.sections?.[key]?.gaps || [];
            return <Tooltip key={key} title={gaps.join(' · ') || SECTION_STATUS_LABELS[st]} placement="right"><ListItemButton selected={focusedKey === key} onClick={() => onSelect?.(key)} aria-label={`${titleOf(key)} — ${SECTION_STATUS_LABELS[st]}`} sx={{ pl: 4, pr: 2, py: .75, gap: 1.25 }}><Box className="status-dot" sx={{ ...SECTION_DOT[st], width: 7, height: 7 }} aria-hidden="true" /><Typography sx={{ fontSize: 12.5, color: 'text.secondary', fontWeight: focusedKey === key ? 700 : 400 }}>{titleOf(key)}</Typography></ListItemButton></Tooltip>;
          })}
        </React.Fragment>;
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
