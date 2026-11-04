import React from 'react';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Tooltip from '@mui/material/Tooltip';
import Add from '@mui/icons-material/Add';
import Close from '@mui/icons-material/Close';

const WorkspaceTabs = ({ tabs, activeId, onSelect, onClose, onNew, extra }) => (
  <Box
    sx={{
      display: 'flex',
      alignItems: 'center',
      borderBottom: '1px solid',
      borderColor: 'divider',
      px: 1.5,
      bgcolor: 'background.paper',
      minHeight: 38,
      maxHeight: 38,
    }}
  >
    <Tabs
      value={activeId && tabs.some((t) => t.id === activeId) ? activeId : false}
      onChange={(_e, value) => onSelect(value)}
      variant="scrollable"
      scrollButtons="auto"
      sx={{
        flexGrow: 1,
        minHeight: 38,
        '& .MuiTabs-indicator': {
          height: 2,
          bgcolor: 'primary.main',
        },
      }}
    >
      {tabs.map((t) => (
        <Tab
          key={t.id}
          value={t.id}
          disableRipple
          sx={{
            minHeight: 38,
            py: 0.5,
            px: 1.5,
            textTransform: 'none',
            fontSize: '0.8125rem',
            fontWeight: t.id === activeId ? 600 : 500,
            color: t.id === activeId ? 'text.primary' : 'text.secondary',
            '&:hover': {
              color: 'text.primary',
            },
          }}
          label={(
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <Box
                sx={{
                  maxWidth: 160,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {t.title || 'Untitled Syllabus'}
              </Box>
              <IconButton
                size="small"
                component="span"
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(t.id);
                }}
                sx={{
                  p: 0.25,
                  borderRadius: 0.5,
                  opacity: 0.6,
                  '&:hover': { opacity: 1, bgcolor: 'action.hover' },
                }}
              >
                <Close sx={{ fontSize: 13 }} />
              </IconButton>
            </Box>
          )}
        />
      ))}
    </Tabs>
    {extra}
    <Tooltip title="New syllabus">
      <IconButton
        size="small"
        onClick={onNew}
        sx={{
          ml: 1,
          p: 0.5,
          borderRadius: 1,
          border: '1px dashed',
          borderColor: 'divider',
          '&:hover': { borderColor: 'primary.main', bgcolor: 'background.default' },
        }}
      >
        <Add sx={{ fontSize: 16 }} />
      </IconButton>
    </Tooltip>
  </Box>
);

export default WorkspaceTabs;
