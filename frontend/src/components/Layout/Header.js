import React, { useState } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Button from '@mui/material/Button';
import Avatar from '@mui/material/Avatar';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Divider from '@mui/material/Divider';
import Chip from '@mui/material/Chip';
import Tooltip from '@mui/material/Tooltip';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import ToggleButton from '@mui/material/ToggleButton';
import DarkModeOutlined from '@mui/icons-material/DarkModeOutlined';
import LightModeOutlined from '@mui/icons-material/LightModeOutlined';
import SettingsBrightnessOutlined from '@mui/icons-material/SettingsBrightnessOutlined';
import SettingsOutlined from '@mui/icons-material/SettingsOutlined';
import LogoutOutlined from '@mui/icons-material/LogoutOutlined';
import ColorLensOutlined from '@mui/icons-material/ColorLensOutlined';

import { useAuth } from '../../contexts/AuthContext';
import { useThemeMode } from '../../contexts/ThemeContext';
import { useCohort } from '../../contexts/CohortContext';
import { useWorkspaceChrome } from '../../contexts/WorkspaceChromeContext';
import CircularProgress from '@mui/material/CircularProgress';
import FileDownloadOutlined from '@mui/icons-material/FileDownloadOutlined';
import { S } from '../../strings';
import { ROLE_LABELS } from '../../utils/roles';

const Header = () => {
  const { user, logout } = useAuth();
  const { mode, setMode, brandPreset, setBrandPreset } = useThemeMode();
  const { currentProgram, currentCohort } = useCohort();
  const { chrome } = useWorkspaceChrome();
  const location = useLocation();
  const navigate = useNavigate();

  const [anchorEl, setAnchorEl] = useState(null);
  const isWorkspace = location.pathname.startsWith('/workspace');
  const isCabinet = location.pathname.startsWith('/cabinet');

  const handleMenu = (event) => setAnchorEl(event.currentTarget);
  const handleClose = () => setAnchorEl(null);

  const handleProfile = () => {
    handleClose();
    navigate('/settings');
  };

  const handleLogout = () => {
    handleClose();
    logout();
    navigate('/login');
  };

  const handleThemeChange = (e, newMode) => {
    if (newMode) setMode(newMode);
  };

  const toggleBrand = () => {
    setBrandPreset(brandPreset === 'kse-green' ? 'kse-studio' : 'kse-green');
  };

  const getUserInitials = (u) => {
    if (!u) return 'U';
    const first = u.firstName?.charAt(0) || '';
    const last = u.lastName?.charAt(0) || '';
    return (first + last).toUpperCase() || u.email?.charAt(0).toUpperCase() || 'U';
  };

  return (
    <Box
      component="header"
      sx={{
        height: 52,
        minHeight: 52,
        maxHeight: 52,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        px: 2,
        bgcolor: 'background.paper',
        borderBottom: '1px solid',
        borderColor: 'divider',
        position: 'sticky',
        top: 0,
        zIndex: 1100,
      }}
    >
      {/* Ліва зона: Логотип + Назва */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: { xs: 'auto', md: 180 }, flexShrink: 0 }}>
        <Box
          component={Link}
          to="/"
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            textDecoration: 'none',
            color: 'inherit',
          }}
        >
          <Box
            sx={{
              bgcolor: 'primary.main',
              color: 'primary.contrastText',
              fontWeight: 800,
              fontSize: '0.8125rem',
              letterSpacing: '0.05em',
              px: 1,
              py: 0.35,
              borderRadius: 0.5,
              lineHeight: 1,
            }}
          >
            KSE
          </Box>
          <Typography
            variant="h2"
            sx={{
              display: { xs: 'none', sm: 'block' },
              fontSize: '0.9375rem',
              fontWeight: 600,
              letterSpacing: '-0.01em',
              color: 'text.primary',
              whiteSpace: 'nowrap',
            }}
          >
            Syllabus Studio
          </Typography>
        </Box>
      </Box>

      {/* Центральна зона: Назва курсу, Програма, Контекст готовності (якщо у Workspace) */}
      <Box
        id="kse-workspace-header-center"
        sx={{
          display: { xs: 'none', lg: 'flex' },
          alignItems: 'center',
          gap: 1.5,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          flex: '1 1 auto',
          justifyContent: 'center',
          px: 2,
        }}
      >
        {isWorkspace && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, maxWidth: '100%' }}>
            <Chip
              label={`${currentProgram} · ${currentCohort}`}
              size="small"
              variant="outlined"
              sx={{
                height: 22,
                fontSize: '0.75rem',
                fontWeight: 500,
                borderColor: 'divider',
                bgcolor: 'background.default',
              }}
            />
          </Box>
        )}
      </Box>

      {/* Права зона: Readiness, Download, навігація, тема, профіль */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: { xs: 0.5, sm: 1 }, minWidth: 0, justifyContent: 'flex-end' }}>
        {isWorkspace && chrome && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: { xs: 0.75, sm: 1.5 }, mr: { xs: 0.5, sm: 1 } }}>
            <Box sx={{ textAlign: 'right', lineHeight: 1.2 }} aria-label={`${S.readiness}: ${chrome.readinessLabel}`}>
              <Typography variant="caption" color="text.secondary" sx={{ display: { xs: 'none', sm: 'block' }, fontSize: '0.6875rem' }}>
                {S.readiness}
              </Typography>
              <Typography component="span" sx={{ fontSize: '0.875rem', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                {chrome.readinessValue}
              </Typography>
              {chrome.approvedLabel && (
                <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 0.75, display: { xs: 'none', lg: 'inline' } }}>
                  {chrome.approvedLabel}
                </Typography>
              )}
            </Box>
            {chrome.openChecks > 0 && (
              <Button
                size="small"
                variant="text"
                color="warning"
                onClick={chrome.onFocusCheck}
                sx={{
                  height: 26,
                  fontSize: '0.75rem',
                  px: 0.75,
                  minWidth: 0,
                  whiteSpace: 'nowrap',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {chrome.openChecks} {chrome.openChecks === 1 ? 'check' : 'checks'} open
              </Button>
            )}
            <Button
              size="small"
              variant="contained"
              startIcon={chrome.downloading ? <CircularProgress size={14} color="inherit" /> : <FileDownloadOutlined fontSize="small" />}
              disabled={!chrome.canDownload || chrome.downloading}
              onClick={chrome.onDownload}
              sx={{ height: 28, fontSize: { xs: '0.75rem', sm: '0.8125rem' }, px: { xs: 1, sm: 1.5 }, whiteSpace: 'nowrap', flexShrink: 0 }}
            >
              {chrome.downloading ? S.downloading : S.downloadDocx}
            </Button>
          </Box>
        )}
        {/* Workspace / Cabinet switcher */}
        <Box sx={{ display: { xs: 'none', sm: 'flex' }, alignItems: 'center', gap: 0.5, mr: 0.5 }}>
          <Button
            component={Link}
            to="/workspace"
            size="small"
            variant={isWorkspace ? 'contained' : 'text'}
            color={isWorkspace ? 'primary' : 'inherit'}
            sx={{
              height: 28,
              fontSize: '0.8125rem',
              px: 1.5,
              borderRadius: 1,
              fontWeight: isWorkspace ? 600 : 500,
            }}
          >
            Workspace
          </Button>
          <Button
            component={Link}
            to="/cabinet"
            size="small"
            variant={isCabinet ? 'contained' : 'text'}
            color={isCabinet ? 'primary' : 'inherit'}
            sx={{
              height: 28,
              fontSize: '0.8125rem',
              px: 1.5,
              borderRadius: 1,
              fontWeight: isCabinet ? 600 : 500,
            }}
          >
            Cabinet
          </Button>
        </Box>

        {/* Перемикач пресету бренду (KSE Green vs Studio) */}
        <Tooltip title={`Palette: ${brandPreset === 'kse-green' ? 'KSE Green' : 'KSE Studio'}`}>
          <IconButton size="small" onClick={toggleBrand} sx={{ p: 0.5, color: 'text.secondary', display: { xs: 'none', md: 'inline-flex' } }}>
            <ColorLensOutlined fontSize="small" />
          </IconButton>
        </Tooltip>

        {/* Перемикач теми Light/Dark/System */}
        <ToggleButtonGroup
          value={mode}
          exclusive
          size="small"
          onChange={handleThemeChange}
          sx={{
            display: { xs: 'none', md: 'inline-flex' },
            height: 28,
            bgcolor: 'background.default',
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 1,
            '& .MuiToggleButton-root': {
              border: 0,
              py: 0.25,
              px: 0.75,
              color: 'text.secondary',
              '&.Mui-selected': {
                bgcolor: 'background.paper',
                color: 'primary.main',
                fontWeight: 600,
              },
            },
          }}
        >
          <ToggleButton value="system" title="System Theme">
            <SettingsBrightnessOutlined sx={{ fontSize: 15 }} />
          </ToggleButton>
          <ToggleButton value="light" title="Light Theme">
            <LightModeOutlined sx={{ fontSize: 15 }} />
          </ToggleButton>
          <ToggleButton value="dark" title="Dark Theme">
            <DarkModeOutlined sx={{ fontSize: 15 }} />
          </ToggleButton>
        </ToggleButtonGroup>

        {/* Аватар та меню користувача */}
        <IconButton
          size="small"
          onClick={handleMenu}
          sx={{ ml: 0.5, p: 0.25 }}
          aria-label="Account menu"
          aria-controls="menu-account"
          aria-haspopup="true"
        >
          <Avatar
            sx={{
              width: 28,
              height: 28,
              bgcolor: 'primary.main',
              color: 'primary.contrastText',
              fontSize: '0.75rem',
              fontWeight: 600,
            }}
          >
            {getUserInitials(user)}
          </Avatar>
        </IconButton>

        <Menu
          id="menu-account"
          anchorEl={anchorEl}
          open={Boolean(anchorEl)}
          onClose={handleClose}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          transformOrigin={{ vertical: 'top', horizontal: 'right' }}
          sx={{
            mt: 1,
            '& .MuiPaper-root': {
              minWidth: 220,
              border: '1px solid',
              borderColor: 'divider',
              boxShadow: '0 4px 16px rgba(0,0,0,0.1)',
            },
          }}
        >
          <Box sx={{ px: 2, py: 1.25 }}>
            <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.primary' }}>
              {user?.firstName} {user?.lastName}
            </Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 0.5 }}>
              {user?.email}
            </Typography>
            <Chip
              label={ROLE_LABELS[user?.role] || 'Instructor'}
              size="small"
              sx={{
                height: 20,
                fontSize: '0.6875rem',
                fontWeight: 600,
                bgcolor: 'background.default',
                color: 'text.secondary',
              }}
            />
          </Box>
          <Divider />
          <MenuItem onClick={handleProfile} sx={{ fontSize: '0.8125rem', py: 1 }}>
            <SettingsOutlined sx={{ mr: 1.5, fontSize: 18, color: 'text.secondary' }} />
            Account settings
          </MenuItem>
          <Divider />
          <MenuItem onClick={handleLogout} sx={{ fontSize: '0.8125rem', py: 1, color: 'error.main' }}>
            <LogoutOutlined sx={{ mr: 1.5, fontSize: 18 }} />
            Sign out
          </MenuItem>
        </Menu>
      </Box>
    </Box>
  );
};

export default Header;
