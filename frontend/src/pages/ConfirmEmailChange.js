import React, { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import { useSearchParams, useNavigate } from 'react-router-dom';
import api from '../services/api';

export default function ConfirmEmailChange() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    const token = params.get('token');
    if (!token) {
      setErr('The confirmation token is missing.');
      setLoading(false);
      return;
    }
    (async () => {
      try {
        await api.emailChange.confirm(token);
        setMsg('Your email has been verified and updated successfully.');
      } catch (e) {
        setErr(e.response?.data?.message || 'Could not confirm the email change.');
      } finally {
        setLoading(false);
      }
    })();
  }, [params]);

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '70vh',
        p: 2,
      }}
    >
      <Paper
        variant="outlined"
        sx={{
          maxWidth: 440,
          width: '100%',
          p: 4,
          textAlign: 'center',
          borderColor: 'divider',
        }}
      >
        <Typography variant="h1" sx={{ fontSize: '1.25rem', fontWeight: 600, mb: 2 }}>
          Confirm Email Change
        </Typography>

        {loading && <CircularProgress size={32} sx={{ my: 2 }} />}
        {!loading && msg && (
          <Alert severity="success" sx={{ mb: 3, borderRadius: 1 }}>
            {msg}
          </Alert>
        )}
        {!loading && err && (
          <Alert severity="error" sx={{ mb: 3, borderRadius: 1 }}>
            {err}
          </Alert>
        )}

        {!loading && (
          <Button variant="contained" onClick={() => navigate('/settings')}>
            Return to Account Settings
          </Button>
        )}
      </Paper>
    </Box>
  );
}
