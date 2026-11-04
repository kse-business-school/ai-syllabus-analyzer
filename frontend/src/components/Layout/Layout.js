import React from 'react';
import { Outlet } from 'react-router-dom';
import Box from '@mui/material/Box';
import Header from './Header';

const Layout = () => {
  return (
    <Box
      sx={{
        minHeight: '100vh',
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        bgcolor: 'background.default',
        color: 'text.primary',
        overflow: 'hidden',
      }}
    >
      <Header />
      <Box
        component="main"
        sx={{
          flex: '1 1 auto',
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        <Outlet />
      </Box>
    </Box>
  );
};

export default Layout;
