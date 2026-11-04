import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import Forum from '@mui/icons-material/Forum';
import AdminPanelSettings from '@mui/icons-material/AdminPanelSettings';
import School from '@mui/icons-material/School';
import Policy from '@mui/icons-material/Policy';
import { useAuth } from '../../contexts/AuthContext';
import { ALL_ROLES, ROLE_LABELS } from '../../utils/roles';

const Sidebar = ({ onItemClick }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();

  const handleNavigation = (path) => {
    if (path === '/workspace') {
      const userId = user?.id || user?._id || 'anon';
      const lastChatId = localStorage.getItem(`pt.lastChat.v1.${userId}`);
      let targetId = lastChatId;
      try {
        const tabs = JSON.parse(localStorage.getItem(`pt.openTabs.v1.${userId}`) || '[]');
        if (targetId && Array.isArray(tabs) && tabs.length && !tabs.some((tab) => tab.id === targetId)) {
          localStorage.removeItem(`pt.lastChat.v1.${userId}`);
          targetId = null;
        }
      } catch {
        // Ігноруємо пошкоджені дані сховища та відкриваємо початковий екран.
        targetId = null;
      }
      navigate(targetId ? `/workspace/${targetId}` : path);
    } else {
      navigate(path);
    }
    if (onItemClick) onItemClick();
  };

  const isActive = (path) => {
    if (path === '/workspace' || path === '/cabinet') {
      return location.pathname === path || location.pathname.startsWith(path + '/');
    }
    return location.pathname === path;
  };

  const items = [
    {
      text: "Chat",
      icon: <Forum />,
      path: '/workspace',
      roles: ALL_ROLES,
    },
    {
      text: user?.role === 'admin' ? "Cabinet" : "My syllabi",
      icon: <AdminPanelSettings />,
      path: '/cabinet',
      roles: ALL_ROLES,
    },
    {
      text: "Documents",
      icon: <Policy />,
      path: '/policies',
      roles: ALL_ROLES,
    },
  ].filter((item) => item.roles.includes(user?.role));

  const roleColors = { admin: 'error', instructor: 'primary', manager: 'secondary', director: 'secondary' };
  const roleLabels = ROLE_LABELS;

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Toolbar
        sx={{
          display: 'flex',
          alignItems: 'center',
          px: 2,
          borderBottom: '1px solid',
          borderColor: 'divider',
        }}
      >
        <School color="primary" sx={{ mr: 1 }} />
        <Typography variant="h6" color="primary" fontWeight="600">
          KSE
        </Typography>
        {user?.role && (
          <Chip
            label={roleLabels[user.role] || user.role}
            color={roleColors[user.role] || 'default'}
            size="small"
            sx={{ ml: 1 }}
          />
        )}
      </Toolbar>

      <Box sx={{ flexGrow: 1, overflow: 'auto' }}>
        <List sx={{ px: 1, py: 2 }}>
          {items.map((item) => (
            <ListItem key={item.text} disablePadding>
              <ListItemButton
                selected={isActive(item.path)}
                onClick={() => handleNavigation(item.path)}
                sx={{
                  borderRadius: 2,
                  mb: 0.5,
                  '&.Mui-selected': {
                    backgroundColor: 'primary.main',
                    color: 'primary.contrastText',
                    '&:hover': { backgroundColor: 'primary.dark' },
                    '& .MuiListItemIcon-root': { color: 'primary.contrastText' },
                  },
                }}
              >
                <ListItemIcon
                  sx={{
                    minWidth: 40,
                    color: isActive(item.path) ? 'inherit' : 'text.secondary',
                  }}
                >
                  {item.icon}
                </ListItemIcon>
                <ListItemText
                  primary={item.text}
                  primaryTypographyProps={{
                    fontWeight: isActive(item.path) ? 600 : 400,
                    fontSize: '0.875rem',
                  }}
                />
              </ListItemButton>
            </ListItem>
          ))}
        </List>
      </Box>

      <Box sx={{ p: 2, borderTop: '1px solid', borderColor: 'divider' }}>
        <Typography variant="body2" color="text.secondary">
          {user?.firstName} {user?.lastName}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {user?.email || 'kse.edu'}
        </Typography>
      </Box>
    </Box>
  );
};

export default Sidebar;
