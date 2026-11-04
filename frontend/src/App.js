import React, { Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';

import { useAuth } from './contexts/AuthContext';
import Layout from './components/Layout/Layout';
import ProtectedRoute from './components/Auth/ProtectedRoute';

// Auth pages
import Login from './components/Auth/Login';
import ResetPassword from './components/Auth/ResetPassword';
import ConfirmEmailChange from './pages/ConfirmEmailChange';

// Main pages
import ProfessorTutorWorkspace from './pages/ProfessorTutorWorkspace';
import Cabinet from './pages/Cabinet';
import AccountSettings from './pages/AccountSettings';
import PoliciesPage from './pages/PoliciesPage';

const DevCards = process.env.NODE_ENV === 'development'
  ? React.lazy(() => import('./pages/DevCards'))
  : null;

function App() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <Box
        display="flex"
        justifyContent="center"
        alignItems="center"
        minHeight="100vh"
        bgcolor="background.default"
      >
        <CircularProgress size={36} />
      </Box>
    );
  }

  const defaultRoute = user?.role === 'admin' ? '/cabinet' : '/workspace';

  return (
    <Routes>
      {/* Public routes */}
      <Route
        path="/login"
        element={user ? <Navigate to={defaultRoute} replace /> : <Login />}
      />
      <Route path="/confirm-email-change" element={<ConfirmEmailChange />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      {DevCards && (
        <Route
          path="/dev/cards"
          element={
            <Suspense fallback={null}>
              <DevCards />
            </Suspense>
          }
        />
      )}

      {/* Protected routes */}
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to={defaultRoute} replace />} />
        <Route path="workspace" element={<ProfessorTutorWorkspace />} />
        <Route path="workspace/:syllabusId" element={<ProfessorTutorWorkspace />} />
        <Route
          path="cabinet"
          element={
            <ProtectedRoute requiredRoles={['admin', 'instructor']}>
              <Cabinet />
            </ProtectedRoute>
          }
        />
        {/* Unified Account Settings */}
        <Route path="settings" element={<AccountSettings />} />
        {/* Backward-compatibility redirect */}
        <Route path="profile" element={<Navigate to="/settings" replace />} />
        <Route path="policies" element={<PoliciesPage />} />
      </Route>

      {/* 404 route */}
      <Route path="*" element={<Navigate to={defaultRoute} replace />} />
    </Routes>
  );
}

export default App;
