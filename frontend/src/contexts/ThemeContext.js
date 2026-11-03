import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { ThemeProvider, createTheme, alpha } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useAuth } from './AuthContext';
import api from '../services/api';

const ThemeModeContext = createContext();

export const TOKENS = {
  brand: {
    kseGreen: {
      light: { main: '#004641', hover: '#003632', contrastText: '#ffffff' },
      dark: { main: '#2dd4bf', hover: '#14b8a6', contrastText: '#0f1115' },
    },
    kseStudio: {
      light: { main: '#0b57d0', hover: '#0842a0', contrastText: '#ffffff' },
      dark: { main: '#8ab4f8', hover: '#aecbfa', contrastText: '#0f1115' },
    },
  },
  neutral: {
    light: {
      bg: '#ffffff',
      paper: '#f7f7f8',
      subtle: '#eff1f3',
      text: '#1b1b1e',
      textSecondary: '#5a5d64',
      border: '#e4e6ea',
    },
    dark: {
      bg: '#0f1115',
      paper: '#161920',
      subtle: '#1e222b',
      text: '#f1f3f5',
      textSecondary: '#9ba1ab',
      border: '#262a34',
    },
  },
  radius: { base: 8, card: 12, dialog: 16, pill: 999 },
};

export function buildTheme(mode = 'light', brandPreset = 'kse-green') {
  const isDark = mode === 'dark';
  const n = TOKENS.neutral[isDark ? 'dark' : 'light'];
  const brandColors = brandPreset === 'kse-studio' 
    ? TOKENS.brand.kseStudio[isDark ? 'dark' : 'light']
    : TOKENS.brand.kseGreen[isDark ? 'dark' : 'light'];
  const { radius } = TOKENS;

  return createTheme({
    palette: {
      mode,
      primary: brandColors,
      secondary: {
        main: '#b06000',
      },
      warning: {
        main: '#b06000',
        contrastText: '#ffffff',
      },
      success: {
        main: '#137333',
        contrastText: '#ffffff',
      },
      error: {
        main: '#c5221f',
        contrastText: '#ffffff',
      },
      info: {
        main: '#0b57d0',
        contrastText: '#ffffff',
      },
      background: { default: n.bg, paper: n.paper },
      text: { primary: n.text, secondary: n.textSecondary },
      divider: n.border,
    },
    typography: {
      fontFamily: `'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif`,
      h1: { fontSize: '1.25rem', fontWeight: 600, letterSpacing: '-0.015em' },
      h2: { fontSize: '0.9375rem', fontWeight: 600 },
      body1: { fontSize: '0.875rem', lineHeight: 1.55 },
      body2: { fontSize: '0.8125rem', lineHeight: 1.5 },
      caption: { fontSize: '0.75rem', fontVariantNumeric: 'tabular-nums' },
    },
    shape: { borderRadius: radius.base },
    components: {
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: {
            borderRadius: radius.pill,
            textTransform: 'none',
            fontWeight: 500,
            fontSize: '0.875rem',
            padding: '6px 14px',
          },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: {
            borderRadius: radius.pill,
            fontWeight: 500,
            fontSize: '0.75rem',
          },
        },
      },
      MuiPaper: { styleOverrides: { rounded: { borderRadius: radius.card } } },
      MuiCard: { styleOverrides: { root: { borderRadius: radius.card } } },
      MuiDialog: { styleOverrides: { paper: { borderRadius: radius.dialog } } },
      MuiAlert: { styleOverrides: { root: { borderRadius: radius.base } } },
      MuiOutlinedInput: { styleOverrides: { root: { borderRadius: radius.base } } },
      MuiListItemButton: {
        styleOverrides: {
          root: {
            borderRadius: radius.base,
            margin: '2px 6px',
            '&.Mui-selected': {
              backgroundColor: alpha(brandColors.main, isDark ? 0.24 : 0.1),
              color: brandColors.main,
              '&:hover': { backgroundColor: alpha(brandColors.main, isDark ? 0.32 : 0.16) },
            },
          },
        },
      },
    },
  });
}

export const ThemeModeProvider = ({ children }) => {
  const { user } = useAuth();
  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)');
  const [mode, setModeState] = useState('system');
  const [brandPreset, setBrandPresetState] = useState('kse-green');

  useEffect(() => {
    if (user?.settings?.theme) setModeState(user.settings.theme);
    if (user?.settings?.brandPreset) setBrandPresetState(user.settings.brandPreset);
  }, [user]);

  const resolvedMode = mode === 'system' ? (prefersDark ? 'dark' : 'light') : mode;

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', resolvedMode);
    document.documentElement.setAttribute('data-brand', brandPreset);
  }, [resolvedMode, brandPreset]);

  const setMode = async (newMode) => {
    setModeState(newMode);
    if (user) {
      try {
        await api.user.updateSettings({ theme: newMode });
      } catch (error) {
        console.error('Failed to save theme preference:', error);
      }
    }
  };

  const setBrandPreset = async (newPreset) => {
    setBrandPresetState(newPreset);
    if (user) {
      try {
        await api.user.updateSettings({ brandPreset: newPreset });
      } catch (error) {
        console.error('Failed to save brand preset:', error);
      }
    }
  };

  const theme = useMemo(() => buildTheme(resolvedMode, brandPreset), [resolvedMode, brandPreset]);

  return (
    <ThemeModeContext.Provider value={{ mode, setMode, brandPreset, setBrandPreset }}>
      <ThemeProvider theme={theme}>{children}</ThemeProvider>
    </ThemeModeContext.Provider>
  );
};

export const useThemeMode = () => useContext(ThemeModeContext);
