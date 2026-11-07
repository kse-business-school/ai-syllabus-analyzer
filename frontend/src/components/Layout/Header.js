import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Box, Typography, IconButton, Avatar, Menu, MenuItem, Divider, ToggleButtonGroup, ToggleButton, Alert, Button, CircularProgress } from '@mui/material';
import DarkModeOutlined from '@mui/icons-material/DarkModeOutlined';
import LightModeOutlined from '@mui/icons-material/LightModeOutlined';
import FileDownloadOutlined from '@mui/icons-material/FileDownloadOutlined';
import { useAuth } from '../../contexts/AuthContext';
import { useThemeMode } from '../../contexts/ThemeContext';
import { useWorkspaceChrome } from '../../contexts/WorkspaceChromeContext';
import { ROLE_LABELS, canSeeAll } from '../../utils/roles';
import BrandLogo from './BrandLogo';

const Header = () => {
  const { user, logout } = useAuth();
  const { mode, resolvedMode, setMode, error } = useThemeMode();
  const { chrome } = useWorkspaceChrome();
  const navigate = useNavigate();
  const location = useLocation();
  const workspace = location.pathname.startsWith('/workspace');
  const [anchor, setAnchor] = useState(null);
  const initials = `${user?.firstName?.[0] || ''}${user?.lastName?.[0] || ''}`.toUpperCase() || 'U';
  const go = path => { setAnchor(null); navigate(path); };
  const toggleTheme = () => setMode(resolvedMode === 'dark' ? 'light' : 'dark');
  return <>
    <Box component="header" sx={{ height: 64, flexShrink: 0, display: 'flex', alignItems: 'center', gap: { xs: 1.5, md: 2.75 }, px: { xs: 1.5, md: 2.25 }, bgcolor: 'background.header', borderBottom: '1px solid', borderColor: 'divider', zIndex: 1100 }}>
      <Box component={Link} to="/workspace" aria-label="Professor’s Tutor home" sx={{ flexShrink: 0 }}><BrandLogo sx={{ width: { xs: 139, sm: 182 }, height: { xs: 28, sm: 34 } }} /></Box>
      <Box id="kse-workspace-header-center" sx={{ display: 'flex', flex: 1, minWidth: 0, alignItems: 'center', overflow: 'hidden' }}>
        {workspace ? <Box id="workspace-tabs-slot" sx={{ flex: 1, minWidth: 0 }} /> : <Box component={Link} to="/workspace" className="brand-plate" sx={{ display: { xs: 'none', sm: 'inline-flex' }, textDecoration: 'none', textTransform: 'none', letterSpacing: 0, fontSize: 13 }}>Professor’s Tutor</Box>}
      </Box>
      <Box className="raster" aria-hidden="true" sx={{ width: 72, height: 25, opacity: .7, display: { xs: 'none', lg: 'block' }, maskImage: 'linear-gradient(90deg, transparent, black 55%, transparent)' }} />
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, flexShrink: 0 }}>
        {/* B-9.5: єдиний контрол завантаження — у шапці */}
        {workspace && chrome && <Button variant="contained" size="small" aria-label="Download Syllabus" title="Download Syllabus" disabled={!chrome.canDownload || chrome.downloading} onClick={chrome.onDownload} startIcon={chrome.downloading ? <CircularProgress size={14} color="inherit" /> : <FileDownloadOutlined sx={{ fontSize: 18 }} />} sx={{ whiteSpace: 'nowrap', minWidth: 0, '& .MuiButton-startIcon': { mr: { xs: 0, sm: 1 } } }}><Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>{chrome.downloading ? 'Preparing…' : 'Download Syllabus'}</Box></Button>}
        <Typography sx={{ display: { xs: 'none', lg: 'block' }, color: 'text.secondary', fontSize: 13 }}>Professor’s Tutor</Typography>
        <IconButton onClick={event => setAnchor(event.currentTarget)} aria-label="Account menu" aria-controls={anchor ? 'account-menu' : undefined} aria-haspopup="true" aria-expanded={Boolean(anchor)} sx={{ p: 0 }}>
          <Avatar src={user?.avatarUrl} sx={{ width: 34, height: 34, bgcolor: 'primary.main', color: 'primary.contrastText', fontSize: 12, fontWeight: 700 }}>{initials}</Avatar>
        </IconButton>
        <IconButton onClick={toggleTheme} title={resolvedMode === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} aria-label={resolvedMode === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} sx={{ width: 34, height: 34, border: '1px solid', borderColor: 'divider', color: 'text.secondary' }}>
          {resolvedMode === 'dark' ? <LightModeOutlined sx={{ fontSize: 17 }} /> : <DarkModeOutlined sx={{ fontSize: 17 }} />}
        </IconButton>
      </Box>
      <Menu id="account-menu" anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }} PaperProps={{ sx: { width: 264, mt: 1.25 } }}>
        <Box sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 1.5 }}><Avatar src={user?.avatarUrl} sx={{ bgcolor: 'primary.main', color: 'primary.contrastText', width: 40, height: 40, fontSize: 13 }}>{initials}</Avatar><Box><Typography sx={{ fontSize: 13.5, fontWeight: 700 }}>{user?.firstName} {user?.lastName}</Typography><Typography variant="caption" color="text.secondary">{ROLE_LABELS[user?.role] || 'Instructor'}</Typography></Box></Box>
        <Divider />
        <MenuItem onClick={() => go('/workspace')}>Workspace</MenuItem>
        <MenuItem onClick={() => go('/cabinet')}>My syllabi</MenuItem>
        {canSeeAll(user?.role) && <MenuItem onClick={() => go('/cabinet?view=all_syllabi')}>All syllabi</MenuItem>}
        <MenuItem onClick={() => go('/cabinet?view=policies')}>Library</MenuItem>
        <MenuItem onClick={() => go('/settings')}>Account settings</MenuItem>
        <Divider />
        <Box sx={{ px: 2, py: 1 }}><Typography variant="caption" sx={{ display: 'block', mb: .75, color: 'text.secondary' }}>Theme</Typography><ToggleButtonGroup size="small" exclusive value={mode} onChange={(_, value) => value && setMode(value)} aria-label="Theme preference"><ToggleButton value="light">Light</ToggleButton><ToggleButton value="dark">Dark</ToggleButton><ToggleButton value="system">System</ToggleButton></ToggleButtonGroup></Box>
        <Divider />
        <MenuItem onClick={() => { setAnchor(null); logout(); navigate('/login'); }}>Sign out</MenuItem>
      </Menu>
    </Box>
    {error && <Alert severity="error">{error}</Alert>}
  </>;
};
export default Header;
