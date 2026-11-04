import React from 'react';
import Box from '@mui/material/Box';
import { useTheme } from '@mui/material/styles';

const BrandLogo = ({ sx }) => {
  const theme = useTheme();
  return <Box component="img" src={`/brand/kse-business-school-${theme.palette.mode === 'dark' ? 'white' : 'green'}.svg`}
    alt="KSE Business School" sx={{ width: 182, height: 34, objectFit: 'contain', display: 'block', ...sx }} />;
};
export default BrandLogo;
