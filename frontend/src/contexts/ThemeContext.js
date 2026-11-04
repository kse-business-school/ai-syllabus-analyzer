import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useAuth } from './AuthContext';
import api from '../services/api';

const ThemeModeContext = createContext();
const THEME_KEY = 'kse_theme';
const modes = ['light', 'dark', 'system'];
const savedMode = () => {
  try { return modes.includes(localStorage.getItem(THEME_KEY)) ? localStorage.getItem(THEME_KEY) : 'system'; }
  catch { return 'system'; }
};
export const TOKENS = {
  brand: { green: '#004641', deep: '#003632', accent: '#2EC195', secondary: '#60BE98', mint: '#94D4C1', plum: '#62005F' },
  neutral: {
    light: { bg: '#EDEFEE', paper: '#FFFFFF', subtle: '#E4E8E6', band: '#DFE8E4', text: '#111112', textSecondary: '#4B5554', muted: '#6B7280', border: 'rgba(17,17,18,.13)', header: '#FFFFFF', flag: '#62005F' },
    dark: { bg: '#0B0B0C', paper: '#161618', subtle: '#222225', band: '#13211E', text: '#FFFFFF', textSecondary: '#B6C1BE', muted: 'rgba(255,255,255,.52)', border: 'rgba(255,255,255,.15)', header: '#111112', flag: '#D79BD4' },
  },
  radius: { base: 0, card: 0, dialog: 0, pill: 0 },
};
export function buildTheme(mode = 'light') {
  const dark = mode === 'dark';
  const n = TOKENS.neutral[dark ? 'dark' : 'light'];
  const primary = dark ? TOKENS.brand.accent : TOKENS.brand.green;
  const plate = dark ? TOKENS.brand.accent : TOKENS.brand.mint;
  return createTheme({
    palette: {
      mode,
      primary: { main: primary, dark: dark ? '#60BE98' : '#003632', contrastText: dark ? '#06302A' : '#FFFFFF' },
      secondary: { main: n.flag }, error: { main: n.flag }, warning: { main: n.flag },
      success: { main: primary }, info: { main: primary },
      background: { default: n.bg, paper: n.paper, canvas: n.paper, subtle: n.subtle, header: n.header, band: n.band },
      text: { primary: n.text, secondary: n.textSecondary, muted: n.muted }, divider: n.border,
      action: { hover: n.subtle, selected: n.band, focus: n.band },
      brand: { plate, plateText: '#06302A', flag: n.flag },
    },
    typography: {
      fontFamily: "Arial, 'Helvetica Neue', Helvetica, 'Liberation Sans', sans-serif",
      h1: { fontSize: '1.5rem', fontWeight: 700, lineHeight: 1.25 },
      h2: { fontSize: '1rem', fontWeight: 700 }, h3: { fontSize: '.9375rem', fontWeight: 700 },
      body1: { fontSize: '.875rem', lineHeight: 1.6 }, body2: { fontSize: '.8125rem', lineHeight: 1.6 },
      caption: { fontSize: '.75rem', lineHeight: 1.55 }, button: { textTransform: 'none', fontWeight: 700 },
    },
    shape: { borderRadius: 0 }, shadows: Array(25).fill('none'),
    components: {
      MuiButton: { defaultProps: { disableElevation: true }, styleOverrides: { root: { borderRadius: 0, padding: '7px 18px', minHeight: 36, fontSize: '.8125rem', textTransform: 'none' }, sizeSmall: { minHeight: 32, padding: '5px 13px', fontSize: '.78125rem' }, outlined: { borderColor: n.muted } } },
      MuiPaper: { defaultProps: { elevation: 0 }, styleOverrides: { root: { backgroundImage: 'none', boxShadow: 'none', borderRadius: 0 } } },
      MuiCard: { styleOverrides: { root: { borderRadius: 0 } } },
      MuiDialog: { styleOverrides: { paper: { borderRadius: 0, border: `1px solid ${n.border}` } } },
      MuiChip: { styleOverrides: { root: { borderRadius: 0, fontWeight: 700, fontSize: '.6875rem' }, filledDefault: { backgroundColor: n.subtle }, filledPrimary: { backgroundColor: plate, color: '#06302A' } } },
      MuiAvatar: { defaultProps: { variant: 'square' }, styleOverrides: { root: { borderRadius: 0 } } },
      MuiIconButton: { styleOverrides: { root: { borderRadius: 0 } } },
      MuiAlert: { styleOverrides: { root: { borderRadius: 0, border: `1px solid ${n.border}`, color: n.text }, standardError: { backgroundColor: dark ? 'rgba(215,155,212,.1)' : 'rgba(98,0,95,.07)' }, standardWarning: { backgroundColor: dark ? 'rgba(215,155,212,.1)' : 'rgba(98,0,95,.07)' } } },
      MuiOutlinedInput: { styleOverrides: { root: { borderRadius: 0, backgroundColor: n.paper }, notchedOutline: { borderColor: n.border } } },
      MuiTab: { styleOverrides: { root: { borderRadius: 0, textTransform: 'none', fontSize: '.8125rem', minHeight: 38 } } },
      MuiTabs: { styleOverrides: { root: { minHeight: 38 } } },
      MuiToggleButton: { styleOverrides: { root: { borderRadius: 0, textTransform: 'none', '&.Mui-selected': { backgroundColor: plate, color: '#06302A', '&:hover': { backgroundColor: plate } } } } },
      MuiListItemButton: { styleOverrides: { root: { borderRadius: 0, margin: 0, '&.Mui-selected': { backgroundColor: n.subtle, boxShadow: `inset 3px 0 0 ${plate}`, '&:hover': { backgroundColor: n.subtle } } } } },
      MuiLinearProgress: { styleOverrides: { root: { borderRadius: 0, backgroundColor: n.subtle } } },
      MuiTableCell: { styleOverrides: { root: { borderColor: n.border, fontSize: '.8125rem' }, head: { color: n.muted, fontSize: '.625rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em' } } },
      MuiAccordion: { styleOverrides: { root: { border: `1px solid ${n.border}`, '&::before': { display: 'none' } } } },
      MuiTooltip: { styleOverrides: { tooltip: { borderRadius: 0 } } },
      MuiMenu: { styleOverrides: { paper: { border: `1px solid ${n.border}` } } },
    },
  });
}
export const ThemeModeProvider = ({ children }) => {
  const { user } = useAuth();
  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)');
  const [mode, setModeState] = useState(savedMode);
  useEffect(() => { if (modes.includes(user?.settings?.theme)) setModeState(user.settings.theme); }, [user?.settings?.theme]);
  const resolvedMode = mode === 'system' ? (prefersDark ? 'dark' : 'light') : mode;
  useEffect(() => {
    document.documentElement.dataset.theme = resolvedMode;
    document.documentElement.style.colorScheme = resolvedMode;
    try { localStorage.setItem(THEME_KEY, mode); } catch { /* сховище недоступне */ }
  }, [mode, resolvedMode]);
  const [error, setError] = useState('');
  const setMode = async (newMode) => {
    if (!modes.includes(newMode)) return;
    const previous = mode;
    setModeState(newMode); setError('');
    if (user) {
      try { await api.user.updateSettings({ theme: newMode }); }
      catch { setModeState(previous); setError('Could not save your theme. Please try again.'); }
    }
  };
  const theme = useMemo(() => buildTheme(resolvedMode), [resolvedMode]);
  return <ThemeModeContext.Provider value={{ mode, resolvedMode, setMode, error }}><ThemeProvider theme={theme}>{children}</ThemeProvider></ThemeModeContext.Provider>;
};
export const useThemeMode = () => useContext(ThemeModeContext);
