import React, { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Divider from '@mui/material/Divider';
import Alert from '@mui/material/Alert';
import Chip from '@mui/material/Chip';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import RadioGroup from '@mui/material/RadioGroup';
import FormControlLabel from '@mui/material/FormControlLabel';
import Radio from '@mui/material/Radio';
import CircularProgress from '@mui/material/CircularProgress';
import { useAuth } from '../contexts/AuthContext';
import { useThemeMode } from '../contexts/ThemeContext';
import api from '../services/api';

const lecturerFields = [
  ['name', 'Full academic name'],
  ['position', 'Academic position'],
  ['officeHours', 'Office hours & consultation schedule'],
  ['assistants', 'Teaching assistants (if any)'],
  ['expertise', 'Areas of expertise (one per line)'],
  ['education', 'Degrees and credentials (one per line)'],
  ['experience', 'Professional and teaching experience (one per line)'],
];
const lecturerLists = ['expertise', 'education', 'experience'];

const lecturerForm = (profile = {}) =>
  Object.fromEntries(
    lecturerFields.map(([key]) => [
      key,
      lecturerLists.includes(key) ? (profile[key] || []).join('\n') : profile[key] || '',
    ])
  );

const AccountSettings = () => {
  const { user, updateProfile } = useAuth();
  const { mode, setMode, brandPreset, setBrandPreset } = useThemeMode();

  // Profile basic info
  const [firstName, setFirstName] = useState(user?.firstName || '');
  const [lastName, setLastName] = useState(user?.lastName || '');
  const [newEmail, setNewEmail] = useState('');
  const [emailMsg, setEmailMsg] = useState('');
  const [emailErr, setEmailErr] = useState('');
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileMsg, setProfileMsg] = useState('');
  const [profileErr, setProfileErr] = useState('');

  // Lecturer profile
  const [lecturer, setLecturer] = useState(null);
  const [lecturerBusy, setLecturerBusy] = useState(false);
  const [lecturerMsg, setLecturerMsg] = useState('');
  const [lecturerErr, setLecturerErr] = useState('');

  // Password change
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwdBusy, setPwdBusy] = useState(false);
  const [pwdMsg, setPwdMsg] = useState('');
  const [pwdErr, setPwdErr] = useState('');

  useEffect(() => {
    let active = true;
    api.lecturerProfile
      .get()
      .then(({ data }) => {
        if (!active) return;
        setLecturer(lecturerForm(data.profile));
      })
      .catch((e) => {
        if (active) setLecturerErr(e.response?.data?.message || 'Could not load lecturer details.');
      });
    return () => {
      active = false;
    };
  }, []);

  const saveBasicProfile = async (e) => {
    e.preventDefault();
    setProfileLoading(true);
    setProfileMsg('');
    setProfileErr('');
    try {
      await updateProfile({ firstName, lastName });
      setProfileMsg('Profile information updated.');
    } catch (err) {
      setProfileErr(err.response?.data?.message || 'Failed to update profile.');
    } finally {
      setProfileLoading(false);
    }
  };

  const requestEmailChange = async (e) => {
    e.preventDefault();
    if (!newEmail.trim()) return;
    setEmailMsg('');
    setEmailErr('');
    try {
      await api.emailChange.request(newEmail.trim());
      setEmailMsg(`Verification email sent to ${newEmail.trim()}. Please click the link to confirm.`);
      setNewEmail('');
    } catch (err) {
      setEmailErr(err.response?.data?.message || 'Could not request email change.');
    }
  };

  const saveLecturerProfile = async (e) => {
    e.preventDefault();
    if (!lecturer) return;
    setLecturerBusy(true);
    setLecturerMsg('');
    setLecturerErr('');
    const payload = Object.fromEntries(
      lecturerFields.map(([key]) => [
        key,
        lecturerLists.includes(key)
          ? lecturer[key]
              .split('\n')
              .map((i) => i.trim())
              .filter(Boolean)
          : lecturer[key],
      ])
    );
    try {
      const { data } = await api.lecturerProfile.update(payload);
      setLecturer(lecturerForm(data.profile));
      setLecturerMsg('Academic instructor profile saved.');
    } catch (err) {
      setLecturerErr(err.response?.data?.message || 'Could not save lecturer profile.');
    } finally {
      setLecturerBusy(false);
    }
  };

  const savePassword = async (e) => {
    e.preventDefault();
    setPwdMsg('');
    setPwdErr('');
    if (newPassword.length < 6) {
      return setPwdErr('New password must be at least 6 characters long.');
    }
    if (newPassword !== confirmPassword) {
      return setPwdErr('New passwords do not match.');
    }
    setPwdBusy(true);
    try {
      await api.user.changePassword(currentPassword, newPassword);
      setPwdMsg('Password updated successfully.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setPwdErr(err.response?.data?.message || 'Could not change password.');
    } finally {
      setPwdBusy(false);
    }
  };

  return (
    <Box sx={{ flex: 1, overflowY: 'auto', p: { xs: 2, md: 4 } }}>
      <Box sx={{ maxWidth: 680, mx: 'auto', display: 'flex', flexDirection: 'column', gap: 3.5 }}>
        <Box>
          <Typography variant="h1" sx={{ fontSize: '1.25rem', fontWeight: 600, mb: 0.5 }}>
            Account Settings
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            Manage your personal profile, institutional preferences, and account security.
          </Typography>
        </Box>

        {/* Card 1: Appearance & Brand Presets */}
        <Paper variant="outlined" sx={{ p: 3, bgcolor: 'background.paper', borderColor: 'divider' }}>
          <Typography variant="h2" sx={{ fontSize: '0.9375rem', fontWeight: 600, mb: 0.5 }}>
            Appearance &amp; Palette
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', fontSize: '0.8125rem', mb: 2.5 }}>
            Choose how KSE Syllabus Studio renders colors, contrast, and surfaces.
          </Typography>

          <Stack spacing={2.5}>
            <FormControl fullWidth size="small" sx={{ maxWidth: 300 }}>
              <InputLabel id="theme-select-label">Theme Mode</InputLabel>
              <Select
                labelId="theme-select-label"
                value={mode}
                label="Theme Mode"
                onChange={(e) => setMode(e.target.value)}
              >
                <MenuItem value="system">System (follows OS)</MenuItem>
                <MenuItem value="light">Light</MenuItem>
                <MenuItem value="dark">Dark</MenuItem>
              </Select>
            </FormControl>

            <Box>
              <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, display: 'block', mb: 1 }}>
                Brand Accent Preset
              </Typography>
              <RadioGroup
                row
                value={brandPreset}
                onChange={(e) => setBrandPreset(e.target.value)}
              >
                <FormControlLabel
                  value="kse-green"
                  control={<Radio size="small" />}
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Box sx={{ width: 12, height: 12, borderRadius: 0.5, bgcolor: '#004641' }} />
                      <Typography variant="body2" sx={{ fontSize: '0.8125rem' }}>
                        KSE Brand Green (#004641)
                      </Typography>
                    </Box>
                  }
                />
                <FormControlLabel
                  value="kse-studio"
                  control={<Radio size="small" />}
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Box sx={{ width: 12, height: 12, borderRadius: 0.5, bgcolor: '#0b57d0' }} />
                      <Typography variant="body2" sx={{ fontSize: '0.8125rem' }}>
                        KSE Studio Blue (#0b57d0)
                      </Typography>
                    </Box>
                  }
                />
              </RadioGroup>
            </Box>
          </Stack>
        </Paper>

        {/* Card 2: Academic Profile & Email */}
        <Paper variant="outlined" sx={{ p: 3, bgcolor: 'background.paper', borderColor: 'divider' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
            <Box>
              <Typography variant="h2" sx={{ fontSize: '0.9375rem', fontWeight: 600, mb: 0.5 }}>
                Academic Profile
              </Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary', fontSize: '0.8125rem' }}>
                Your identity used in syllabus headers and instructor sections.
              </Typography>
            </Box>
            <Chip
              label={user?.role === 'admin' ? 'Administrator' : 'Instructor'}
              size="small"
              sx={{ fontWeight: 600, fontSize: '0.75rem' }}
            />
          </Box>

          {profileMsg && <Alert severity="success" sx={{ mb: 2, borderRadius: 1 }}>{profileMsg}</Alert>}
          {profileErr && <Alert severity="error" sx={{ mb: 2, borderRadius: 1 }}>{profileErr}</Alert>}

          <Box component="form" onSubmit={saveBasicProfile} sx={{ mb: 3 }}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 2 }}>
              <TextField
                label="First Name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                size="small"
                fullWidth
                InputLabelProps={{ shrink: true }}
              />
              <TextField
                label="Last Name"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                size="small"
                fullWidth
                InputLabelProps={{ shrink: true }}
              />
            </Stack>
            <Button
              type="submit"
              variant="contained"
              size="small"
              disabled={profileLoading}
              startIcon={profileLoading ? <CircularProgress size={14} color="inherit" /> : null}
            >
              Update Profile Info
            </Button>
          </Box>

          <Divider sx={{ my: 2.5 }} />

          {/* Email section */}
          <Typography variant="h2" sx={{ fontSize: '0.875rem', fontWeight: 600, mb: 0.5 }}>
            Email Address
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', fontSize: '0.8125rem', mb: 1.5 }}>
            Current email: <strong>{user?.email}</strong>
          </Typography>

          {emailMsg && <Alert severity="success" sx={{ mb: 2, borderRadius: 1 }}>{emailMsg}</Alert>}
          {emailErr && <Alert severity="error" sx={{ mb: 2, borderRadius: 1 }}>{emailErr}</Alert>}

          <Box component="form" onSubmit={requestEmailChange}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems="center">
              <TextField
                label="New Email Address"
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                size="small"
                fullWidth
                placeholder="colleague@kse.org.ua"
                InputLabelProps={{ shrink: true }}
              />
              <Button
                type="submit"
                variant="outlined"
                size="small"
                disabled={!newEmail.trim()}
                sx={{ whiteSpace: 'nowrap', py: 0.85 }}
              >
                Request Change
              </Button>
            </Stack>
          </Box>

          {/* Lecturer fields */}
          {lecturer && (
            <>
              <Divider sx={{ my: 2.5 }} />
              <Typography variant="h2" sx={{ fontSize: '0.875rem', fontWeight: 600, mb: 1.5 }}>
                Syllabus Instructor Template Defaults
              </Typography>
              {lecturerMsg && <Alert severity="success" sx={{ mb: 2, borderRadius: 1 }}>{lecturerMsg}</Alert>}
              {lecturerErr && <Alert severity="error" sx={{ mb: 2, borderRadius: 1 }}>{lecturerErr}</Alert>}
              <Box component="form" onSubmit={saveLecturerProfile}>
                <Stack spacing={2} sx={{ mb: 2 }}>
                  {lecturerFields.map(([key, label]) => (
                    <TextField
                      key={key}
                      label={label}
                      value={lecturer[key] || ''}
                      onChange={(e) => setLecturer({ ...lecturer, [key]: e.target.value })}
                      multiline={lecturerLists.includes(key)}
                      rows={lecturerLists.includes(key) ? 2 : 1}
                      size="small"
                      fullWidth
                      InputLabelProps={{ shrink: true }}
                    />
                  ))}
                </Stack>
                <Button
                  type="submit"
                  variant="outlined"
                  size="small"
                  disabled={lecturerBusy}
                  startIcon={lecturerBusy ? <CircularProgress size={14} color="inherit" /> : null}
                >
                  Save Instructor Details
                </Button>
              </Box>
            </>
          )}
        </Paper>

        {/* Card 3: Security & Password */}
        <Paper variant="outlined" sx={{ p: 3, bgcolor: 'background.paper', borderColor: 'divider' }}>
          <Typography variant="h2" sx={{ fontSize: '0.9375rem', fontWeight: 600, mb: 0.5 }}>
            Security &amp; Password
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', fontSize: '0.8125rem', mb: 2 }}>
            Change your password to maintain account integrity.
          </Typography>

          {pwdMsg && <Alert severity="success" sx={{ mb: 2, borderRadius: 1 }}>{pwdMsg}</Alert>}
          {pwdErr && <Alert severity="error" sx={{ mb: 2, borderRadius: 1 }}>{pwdErr}</Alert>}

          <Box component="form" onSubmit={savePassword}>
            <Stack spacing={2} sx={{ mb: 2 }}>
              <TextField
                label="Current Password"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                size="small"
                fullWidth
                required
                InputLabelProps={{ shrink: true }}
              />
              <TextField
                label="New Password (min 6 characters)"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                size="small"
                fullWidth
                required
                InputLabelProps={{ shrink: true }}
              />
              <TextField
                label="Confirm New Password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                size="small"
                fullWidth
                required
                InputLabelProps={{ shrink: true }}
              />
            </Stack>
            <Button
              type="submit"
              variant="contained"
              size="small"
              disabled={pwdBusy || !currentPassword || !newPassword}
              startIcon={pwdBusy ? <CircularProgress size={14} color="inherit" /> : null}
            >
              Update Password
            </Button>
          </Box>
        </Paper>
      </Box>
    </Box>
  );
};

export default AccountSettings;
