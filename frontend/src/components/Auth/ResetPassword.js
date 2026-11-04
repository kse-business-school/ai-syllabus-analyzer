import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import { useAuth } from '../../contexts/AuthContext';

const ResetPassword = () => {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { forgotPassword, resetPassword } = useAuth();

  const existingToken = params.get('token');

  const [mode, setMode] = useState(existingToken ? 'reset' : 'request');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    setMode(existingToken ? 'reset' : 'request');
  }, [existingToken]);

  const handleRequest = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);
    try {
      const res = await forgotPassword(email);
      if (!res.success) throw new Error(res.error || 'Request failed');
      setSuccess('If an account exists for this email, we have sent password reset instructions.');
    } catch (err) {
      setError(err.message || 'Request failed');
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    if (password.length < 6) {
      setError('Your password must contain at least 6 characters.');
      return;
    }
    if (password !== confirm) {
      setError('The passwords do not match.');
      return;
    }
    setLoading(true);
    try {
      const res = await resetPassword(existingToken, password);
      if (!res.success) throw new Error(res.error || 'Could not reset your password');
      setSuccess('Your password has been changed. You can now sign in.');
      setTimeout(() => navigate('/login'), 1200);
    } catch (err) {
      setError(err.message || 'Could not reset your password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: 'background.default',
        p: 2,
      }}
    >
      <Paper
        variant="outlined"
        sx={{
          maxWidth: 420,
          width: '100%',
          p: { xs: 3, sm: 4 },
          bgcolor: 'background.paper',
          borderColor: 'divider',
          boxShadow: '0 4px 20px rgba(0,0,0,0.06)',
        }}
      >
        <Box sx={{ textAlign: 'center', mb: 3 }}>
          <Box
            sx={{
              display: 'inline-block',
              bgcolor: 'primary.main',
              color: 'primary.contrastText',
              fontWeight: 800,
              fontSize: '1rem',
              letterSpacing: '0.06em',
              px: 1.5,
              py: 0.5,
              borderRadius: 0.5,
              mb: 1.5,
            }}
          >
            KSE
          </Box>
          <Typography variant="h1" sx={{ fontSize: '1.25rem', fontWeight: 600, mb: 0.5 }}>
            {mode === 'request' ? 'Password Recovery' : 'Reset Password'}
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', fontSize: '0.8125rem' }}>
            {mode === 'request'
              ? 'Enter your academic email to receive reset instructions'
              : 'Enter a new secure password'}
          </Typography>
        </Box>

        {error && (
          <Alert severity="error" sx={{ mb: 2.5, borderRadius: 1 }} onClose={() => setError('')}>
            {error}
          </Alert>
        )}
        {success && (
          <Alert severity="success" sx={{ mb: 2.5, borderRadius: 1 }}>
            {success}
          </Alert>
        )}

        {mode === 'request' ? (
          <Box component="form" onSubmit={handleRequest}>
            <TextField
              fullWidth
              label="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              size="small"
              autoFocus
              sx={{ mb: 2.5 }}
              InputLabelProps={{ shrink: true }}
            />
            <Button
              type="submit"
              fullWidth
              variant="contained"
              disabled={loading}
              startIcon={loading ? <CircularProgress size={16} color="inherit" /> : null}
              sx={{ py: 1, mb: 2 }}
            >
              {loading ? 'Sending instructions…' : 'Send reset link'}
            </Button>
          </Box>
        ) : (
          <Box component="form" onSubmit={handleReset}>
            <TextField
              fullWidth
              label="New Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              size="small"
              autoFocus
              sx={{ mb: 2 }}
              InputLabelProps={{ shrink: true }}
            />
            <TextField
              fullWidth
              label="Confirm New Password"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              size="small"
              sx={{ mb: 2.5 }}
              InputLabelProps={{ shrink: true }}
            />
            <Button
              type="submit"
              fullWidth
              variant="contained"
              disabled={loading}
              startIcon={loading ? <CircularProgress size={16} color="inherit" /> : null}
              sx={{ py: 1, mb: 2 }}
            >
              {loading ? 'Updating password…' : 'Save new password'}
            </Button>
          </Box>
        )}

        <Box sx={{ textAlign: 'center', mt: 1 }}>
          <Typography variant="body2" sx={{ fontSize: '0.8125rem' }}>
            <Link to="/login" style={{ color: 'inherit', fontWeight: 500 }}>
              Return to sign in
            </Link>
          </Typography>
        </Box>
      </Paper>
    </Box>
  );
};

export default ResetPassword;
