import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Box, List, ListItemButton, ListItemText, Typography, Select, MenuItem, ListSubheader } from '@mui/material';
import { useAuth } from '../../contexts/AuthContext';
import { cabinetGroupsFor } from '../../utils/cabinetNavigation';
import { ROLE_LABELS } from '../../utils/roles';

const CabinetShell = ({ active, actions, children }) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const groups = cabinetGroupsFor(user?.role || 'instructor');
  const group = groups.find(item => item.items.some(entry => entry.id === active));
  const item = group?.items.find(entry => entry.id === active);
  return <Box sx={{ display: 'flex', flex: 1, minHeight: 0, minWidth: 0, flexDirection: { xs: 'column', md: 'row' } }}>
    <Box component="nav" aria-label="Cabinet navigation" sx={{ width: { md: 248 }, flexShrink: 0, bgcolor: 'background.paper', borderRight: { md: '1px solid' }, borderBottom: { xs: '1px solid', md: 0 }, borderColor: 'divider', display: 'flex', flexDirection: 'column' }}>
      <Select value={active} onChange={event => navigate(groups.flatMap(g => g.items).find(i => i.id === event.target.value).path)} size="small" inputProps={{ 'aria-label': 'Cabinet section' }} sx={{ display: { xs: 'flex', md: 'none' }, m: 1.5 }}>
        {groups.flatMap(g => [<ListSubheader key={g.label}>{g.label}</ListSubheader>, ...g.items.map(i => <MenuItem key={i.id} value={i.id}>{i.label}</MenuItem>)])}
      </Select>
      <Box sx={{ py: 2, display: { xs: 'none', md: 'block' }, flex: 1, overflowY: 'auto' }}>
        {groups.map(g => <Box key={g.label} sx={{ mb: 2 }}>
          <Typography sx={{ px: 2.5, mb: .5, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.12em', color: 'text.muted' }}>{g.label}</Typography>
          <List disablePadding>{g.items.map(i => <ListItemButton key={i.id} component={Link} to={i.path} selected={active === i.id} aria-current={active === i.id ? 'page' : undefined} sx={{ px: 2.5, py: 1 }}>
            <ListItemText primary={i.label} primaryTypographyProps={{ fontSize: 13, fontWeight: active === i.id ? 700 : 400, color: active === i.id ? 'text.primary' : 'text.secondary' }} />
          </ListItemButton>)}</List>
        </Box>)}
      </Box>
      <Box className="raster" sx={{ p: 2.5, borderTop: '1px solid', borderColor: 'divider', display: { xs: 'none', md: 'block' } }}>
        <Box component="span" className="brand-plate">{ROLE_LABELS[user?.role] || 'Instructor'}</Box>
        <Typography variant="caption" sx={{ display: 'block', mt: 1, bgcolor: 'background.paper' }}>{user?.firstName} {user?.lastName}</Typography>
      </Box>
    </Box>
    <Box sx={{ flex: 1, minWidth: 0, overflowY: 'auto', bgcolor: 'background.paper' }}>
      <Box className="raster" sx={{ p: { xs: 2, md: 3.5 }, borderBottom: '1px solid', borderColor: 'divider' }}>
        <Box sx={{ display: 'flex', alignItems: 'stretch', flexWrap: 'wrap', rowGap: 2, justifyContent: 'space-between', gap: 2 }}>
          <Box sx={{ display: 'flex', minWidth: 0, alignItems: 'stretch', flexWrap: 'wrap' }}>
            <Box component="span" className="brand-plate" sx={{ px: 2 }}>{group?.label || 'My work'}</Box>
            <Typography component="h1" sx={{ px: 2, py: 1, fontSize: 18, fontWeight: 700, bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider' }}>{item?.label || 'My syllabi'}</Typography>
          </Box>
          {actions}
        </Box>
      </Box>
      <Box sx={{ p: { xs: 2, md: 3.5 }, pb: 7 }}>{children}</Box>
    </Box>
  </Box>;
};
export default CabinetShell;
