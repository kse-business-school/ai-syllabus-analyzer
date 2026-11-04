import React, { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Alert from '@mui/material/Alert';
import Chip from '@mui/material/Chip';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import CircularProgress from '@mui/material/CircularProgress';
import { useAuth } from '../contexts/AuthContext';
import { useThemeMode } from '../contexts/ThemeContext';
import api from '../services/api';
import Avatar from '@mui/material/Avatar';
import CabinetShell from '../components/Cabinet/CabinetShell';
import { ROLE_LABELS } from '../utils/roles';

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
  const { user, updateProfile, refreshProfile } = useAuth();
  const { mode, setMode } = useThemeMode();

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
      const result = await updateProfile({ firstName, lastName });
      if (!result.success) throw new Error(result.error);
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

  const [photoBusy, setPhotoBusy] = useState(false);
  const changePhoto = async (file) => {
    setProfileErr(''); setProfileMsg('');
    if (file && file.size > 5 * 1024 * 1024) { setProfileErr('Choose a photo smaller than 5 MB.'); return; }
    setPhotoBusy(true);
    try {
      if (file) await api.user.uploadAvatar(file); else await api.user.removeAvatar();
      await refreshProfile();
      setProfileMsg(file ? 'Photo updated.' : 'Photo removed.');
    } catch (err) { setProfileErr(err.response?.data?.message || 'Could not update your photo.'); }
    finally { setPhotoBusy(false); }
  };
  const sectionTitle = { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.11em', display: 'inline-block', pb: .75, mb: 2, borderBottom: '3px solid var(--plate)' };
  return <CabinetShell active="account">
    <Box sx={{ maxWidth: 760 }}>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 4 }}>Your profile, preferences and account security.</Typography>
      {profileMsg && <Alert severity="success" sx={{ mb: 2 }}>{profileMsg}</Alert>}
      {profileErr && <Alert severity="error" sx={{ mb: 2 }}>{profileErr}</Alert>}
      <Box sx={{ mb: 5 }}>
        <Typography component="h2" sx={sectionTitle}>Profile</Typography>
        <Stack direction="row" spacing={2.5} alignItems="center" sx={{ mb: 3 }}>
          <Avatar src={user?.avatarUrl} sx={{ width: 88, height: 88, bgcolor: 'primary.main', color: 'primary.contrastText', fontSize: 26, fontWeight: 700 }}>{user?.firstName?.[0]}{user?.lastName?.[0]}</Avatar>
          <Box>
            <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
              <Button component="label" variant="outlined" disabled={photoBusy}>{photoBusy ? 'Saving…' : 'Change photo'}<input type="file" hidden accept="image/png,image/jpeg,image/webp" aria-label="Profile photo" disabled={photoBusy} onChange={event => { const file = event.target.files?.[0]; if (file) changePhoto(file); event.target.value = ''; }} /></Button>
              {user?.avatarUrl && <Button disabled={photoBusy} onClick={() => changePhoto(null)}>Remove photo</Button>}
            </Stack>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>PNG, JPEG or WebP · up to 5 MB</Typography>
          </Box>
        </Stack>
        <Box component="form" onSubmit={saveBasicProfile}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 2 }}>
            <TextField label="First name" value={firstName} onChange={e => setFirstName(e.target.value)} size="small" fullWidth required />
            <TextField label="Last name" value={lastName} onChange={e => setLastName(e.target.value)} size="small" fullWidth required />
          </Stack>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2.5 }}><Typography variant="body2" color="text.secondary">Role</Typography><Chip label={ROLE_LABELS[user?.role] || 'Instructor'} size="small" /><Typography variant="caption" color="text.secondary">Assigned by your administrator</Typography></Stack>
          <Button type="submit" variant="contained" disabled={profileLoading}>{profileLoading ? 'Saving…' : 'Save profile'}</Button>
        </Box>
      </Box>
      <Box sx={{ mb: 5 }}>
        <Typography component="h2" sx={sectionTitle}>Email address</Typography>
        <Typography variant="body2" sx={{ mb: 2 }}>Current email: <strong>{user?.email}</strong></Typography>
        {emailMsg && <Alert severity="success" sx={{ mb: 2 }}>{emailMsg}</Alert>}
        {emailErr && <Alert severity="error" sx={{ mb: 2 }}>{emailErr}</Alert>}
        <Box component="form" onSubmit={requestEmailChange}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}><TextField label="New email address" type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} size="small" fullWidth required /><Button type="submit" variant="outlined" disabled={!newEmail.trim()} sx={{ whiteSpace: 'nowrap' }}>Request change</Button></Stack>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>Confirm the new address using the link in your email.</Typography>
        </Box>
      </Box>
      <Box sx={{ mb: 5 }}>
        <Typography component="h2" sx={sectionTitle}>Password</Typography>
        {pwdMsg && <Alert severity="success" sx={{ mb: 2 }}>{pwdMsg}</Alert>}
        {pwdErr && <Alert severity="error" sx={{ mb: 2 }}>{pwdErr}</Alert>}
        <Box component="form" onSubmit={savePassword}>
          <Stack spacing={2} sx={{ mb: 2 }}>
            <TextField label="Current password" type="password" autoComplete="current-password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} size="small" fullWidth required />
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField label="New password" type="password" autoComplete="new-password" helperText="At least 6 characters" value={newPassword} onChange={e => setNewPassword(e.target.value)} size="small" fullWidth required />
              <TextField label="Confirm new password" type="password" autoComplete="new-password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} size="small" fullWidth required />
            </Stack>
          </Stack>
          <Button type="submit" variant="outlined" disabled={pwdBusy || !currentPassword || !newPassword}>{pwdBusy ? 'Saving…' : 'Change password'}</Button>
        </Box>
      </Box>
      <Box sx={{ mb: 5 }}>
        <Typography component="h2" sx={sectionTitle}>Preferences</Typography>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField label="Interface language" value="English" size="small" fullWidth InputProps={{ readOnly: true }} helperText="Syllabi and the interface use English." />
          <FormControl fullWidth size="small"><InputLabel id="theme-select-label">Theme</InputLabel><Select labelId="theme-select-label" value={mode} label="Theme" onChange={e => setMode(e.target.value)}><MenuItem value="system">System</MenuItem><MenuItem value="light">Light</MenuItem><MenuItem value="dark">Dark</MenuItem></Select></FormControl>
        </Stack>
      </Box>
      <Box>
        <Typography component="h2" sx={sectionTitle}>Instructor details</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>These details are carried over into new syllabi. You can review them before confirming.</Typography>
        {lecturerErr && <Alert severity="error" sx={{ mb: 2 }}>{lecturerErr}</Alert>}
        {lecturerMsg && <Alert severity="success" sx={{ mb: 2 }}>{lecturerMsg}</Alert>}
        {!lecturer && !lecturerErr && <CircularProgress size={24} />}
        {lecturer && <Box component="form" onSubmit={saveLecturerProfile}><Stack spacing={2} sx={{ mb: 2 }}>{lecturerFields.map(([key, label]) => <TextField key={key} label={label} value={lecturer[key] || ''} onChange={e => setLecturer({ ...lecturer, [key]: e.target.value })} multiline={lecturerLists.includes(key)} minRows={lecturerLists.includes(key) ? 2 : 1} size="small" fullWidth />)}</Stack><Button type="submit" variant="outlined" disabled={lecturerBusy}>{lecturerBusy ? 'Saving…' : 'Save instructor details'}</Button></Box>}
      </Box>
    </Box>
  </CabinetShell>;
};
export default AccountSettings;
