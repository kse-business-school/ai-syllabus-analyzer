import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Box, IconButton, Tab, Tabs, Button } from '@mui/material';
import Close from '@mui/icons-material/Close';

const WorkspaceTabs = ({ tabs, activeId, onSelect, onClose, onNew }) => {
  const [slot, setSlot] = useState(null);
  useEffect(() => { setSlot(document.getElementById('workspace-tabs-slot')); }, []);
  const content = <Box sx={{ display: 'flex', alignItems: 'center', minWidth: 0, width: '100%' }}>
    <Tabs value={activeId && tabs.some(t => t.id === activeId) ? activeId : false} onChange={(_, value) => onSelect(value)} variant="scrollable" scrollButtons="auto" aria-label="Open syllabi" sx={{ minWidth: 0, '& .MuiTabs-indicator': { display: 'none' }, '& .MuiTabs-flexContainer': { gap: 0 } }}>
      {tabs.map(t => <Tab key={t.id} value={t.id} sx={{ px: 1.75, minHeight: 34, minWidth: 90, '&.Mui-selected': { bgcolor: 'brand.plate', color: 'brand.plateText' } }} label={<Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}><Box className="status-dot" sx={{ bgcolor: t.id === activeId ? 'brand.plateText' : 'primary.main' }} /><Box component="span" sx={{ maxWidth: { xs: 90, md: 160 }, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title || 'Untitled syllabus'}</Box><IconButton component="span" role="button" tabIndex={0} aria-label={`Close ${t.title || 'syllabus'}`} onClick={event => { event.stopPropagation(); onClose(t.id); }} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); onClose(t.id); } }} sx={{ p: .2, color: 'inherit' }}><Close sx={{ fontSize: 13 }} /></IconButton></Box>} />)}
    </Tabs>
    <Button onClick={onNew} aria-label="New syllabus" sx={{ minWidth: 64, px: 1, whiteSpace: 'nowrap', fontWeight: activeId ? 400 : 700, bgcolor: activeId ? 'transparent' : 'brand.plate', color: activeId ? 'text.secondary' : 'brand.plateText' }}>+ New</Button>
  </Box>;
  return slot ? createPortal(content, slot) : content;
};
export default WorkspaceTabs;
