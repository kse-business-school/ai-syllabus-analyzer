import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ThemeModeProvider } from './contexts/ThemeContext';
import { CohortProvider } from './contexts/CohortContext';
import CssBaseline from '@mui/material/CssBaseline';

import App from './App';
import { AuthProvider } from './contexts/AuthContext';

import './index.css';

const root = ReactDOM.createRoot(document.getElementById('root'));

root.render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <ThemeModeProvider>
          <CohortProvider>
            <CssBaseline />
            <App />
          </CohortProvider>
        </ThemeModeProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
