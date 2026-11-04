import React, { useState, useEffect } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Alert from '@mui/material/Alert';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import LinearProgress from '@mui/material/LinearProgress';
import Grid from '@mui/material/Grid';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import FormControlLabel from '@mui/material/FormControlLabel';
import Checkbox from '@mui/material/Checkbox';
import CheckCircle from '@mui/icons-material/CheckCircle';
import Warning from '@mui/icons-material/Warning';
import Description from '@mui/icons-material/Description';
import Visibility from '@mui/icons-material/Visibility';
import Download from '@mui/icons-material/Download';
import UploadFile from '@mui/icons-material/UploadFile';
import Delete from '@mui/icons-material/Delete';
import ReactMarkdown from 'react-markdown';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';

const emptyUploadForm = {
  title: '',
  type: 'ai-policy',
  content: '',
  isRequired: true,
  file: null,
};

const PolicyReader = () => {
  const { user } = useAuth();
  const [policies, setPolicies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedPolicy, setSelectedPolicy] = useState(null);
  const [acknowledging, setAcknowledging] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadForm, setUploadForm] = useState(emptyUploadForm);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const isAdmin = user?.role === 'admin';

  useEffect(() => {
    loadPolicies();
  }, []);

  const loadPolicies = async () => {
    try {
      setLoading(true);
      const response = await api.policies.getAll();
      setPolicies(response.data.policies);
    } catch (err) {
      setError("Could not load documents");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleAcknowledge = async (policyId) => {
    try {
      setAcknowledging(true);
      await api.policies.acknowledge(policyId);
      // Refresh policies to update acknowledgment status
      await loadPolicies();
    } catch (err) {
      setError("Could not acknowledge the document");
      console.error(err);
    } finally {
      setAcknowledging(false);
    }
  };

  const handleDownloadFile = async (policyId) => {
    try {
      const response = await api.policies.downloadFile(policyId);
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      const filename = response.headers['content-disposition']?.split('filename=')[1]?.replace(/"/g, '') || 'file';
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError("Could not download the file");
      console.error(err);
    }
  };

  const resetUploadForm = () => {
    setUploadForm(emptyUploadForm);
    setUploadOpen(false);
  };

  const handleCreatePolicy = async () => {
    const title = uploadForm.title.trim();
    const content = uploadForm.content.trim();
    if (!title) {
      setError("Enter the document title");
      return;
    }
    if (!content && !uploadForm.file) {
      setError("Add document text or a file");
      return;
    }

    const formData = new FormData();
    formData.append('title', title);
    formData.append('type', uploadForm.type);
    formData.append('contentType', 'markdown');
    formData.append('isRequired', String(uploadForm.isRequired));
    if (content) formData.append('content', content);
    if (uploadForm.file) formData.append('file', uploadForm.file);

    try {
      setUploading(true);
      setError('');
      await api.policies.create(formData);
      resetUploadForm();
      await loadPolicies();
    } catch (err) {
      setError(err.response?.data?.message || err.message || "Could not upload the document");
    } finally {
      setUploading(false);
    }
  };

  const handleDeletePolicy = async () => {
    if (!deleteTarget?._id) return;
    try {
      setDeleting(true);
      setError('');
      await api.policies.delete(deleteTarget._id);
      setDeleteTarget(null);
      if (selectedPolicy?._id === deleteTarget._id) {
        setSelectedPolicy(null);
      }
      await loadPolicies();
    } catch (err) {
      setError(err.response?.data?.message || err.message || "Could not delete the document");
    } finally {
      setDeleting(false);
    }
  };

  const getTypeLabel = (type) => {
    switch (type) {
      case 'ai-policy': return "AI policy";
      case 'academic-integrity': return "Academic integrity";
      case 'teaching-tips': return "Teaching guidance";
      case 'syllabus-policy': return 'Course policy library';
      default: return type;
    }
  };

  const getTypeColor = (type) => {
    switch (type) {
      case 'ai-policy': return 'primary';
      case 'academic-integrity': return 'error';
      case 'teaching-tips': return 'success';
      case 'syllabus-policy': return 'info';
      default: return 'default';
    }
  };

  const documents = policies.filter((p) => p.type !== 'syllabus-policy');
  const library = policies
    .filter((p) => p.type === 'syllabus-policy')
    .sort((a, b) => (a.order || 0) - (b.order || 0));

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
        <LinearProgress sx={{ width: '100%', maxWidth: 400 }} />
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, mb: 4 }}>
        <Typography variant="h4">
          Documents
        </Typography>
        {isAdmin && (
          <Button variant="contained" startIcon={<UploadFile />} onClick={() => setUploadOpen(true)}>
            Upload document
          </Button>
        )}
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      <Grid container spacing={3}>
        {documents.map((policy) => (
          <Grid item xs={12} md={6} lg={4} key={policy._id}>
            <Card sx={{
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              opacity: policy.isAcknowledged ? 0.7 : 1
            }}>
              <CardContent sx={{ flex: 1 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
                  <Typography variant="h6" sx={{ flex: 1, mr: 1 }}>
                    {policy.title}
                  </Typography>
                  <Chip
                    label={getTypeLabel(policy.type)}
                    color={getTypeColor(policy.type)}
                    size="small"
                  />
                </Box>

                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  {(policy.content || '').substring(0, 200)}...
                </Typography>

                {policy.attachedFile && (
                  <Chip
                    icon={<Description />}
                    label={`File: ${policy.attachedFile.originalName}`}
                    size="small"
                    sx={{ mb: 1 }}
                    variant="outlined"
                  />
                )}

                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                  {policy.isAcknowledged ? (
                    <CheckCircle color="success" />
                  ) : (
                    <Warning color="warning" />
                  )}
                  <Typography variant="body2">
                    {policy.isAcknowledged ? "Acknowledged" : "Not acknowledged"}
                  </Typography>
                </Box>

                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                  {policy.isRequired && (
                    <Chip
                      label="Required"
                      color="error"
                      size="small"
                      variant="outlined"
                    />
                  )}
                  {policy.contentType === 'markdown' && (
                    <Chip
                      label="Markdown"
                      size="small"
                      variant="outlined"
                    />
                  )}
                </Box>
              </CardContent>

              <Box sx={{ p: 2, pt: 0 }}>
                {policy.attachedFile && (
                  <Button
                    fullWidth
                    variant="outlined"
                    startIcon={<Download />}
                    onClick={() => handleDownloadFile(policy._id)}
                    sx={{ mb: 1 }}
                  >
                    Download file
                  </Button>
                )}
                
                <Button
                  fullWidth
                  variant="outlined"
                  startIcon={<Visibility />}
                  onClick={() => setSelectedPolicy(policy)}
                  sx={{ mb: 1 }}
                >
                  View
                </Button>

                {!policy.isAcknowledged && (
                  <Button
                    fullWidth
                    variant="contained"
                    color="success"
                    onClick={() => handleAcknowledge(policy._id)}
                    disabled={acknowledging}
                  >
                    {acknowledging ? "Confirming…" : "Acknowledge"}
                  </Button>
                )}

                {isAdmin && (
                  <Button
                    fullWidth
                    variant="outlined"
                    color="error"
                    startIcon={<Delete />}
                    onClick={() => setDeleteTarget(policy)}
                    sx={{ mt: 1 }}
                  >
                    Delete
                  </Button>
                )}
              </Box>
            </Card>
          </Grid>
        ))}
      </Grid>

      {policies.length === 0 && !error && (
        <Alert severity="info">No documents yet.</Alert>
      )}

      {library.length > 0 && (
        <Box sx={{ mt: 5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
            <Typography variant="h5">Course policy library</Typography>
            <Chip label={getTypeLabel('syllabus-policy')} color={getTypeColor('syllabus-policy')} size="small" />
          </Box>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Approved wording for the Course Policies section. Locked blocks are identical in every syllabus;
            for the others the instructor chooses one option.
          </Typography>
          <Stack spacing={2}>
            {library.map((block) => (
              <Card key={block._id} variant="outlined">
                <CardContent>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 1 }}>
                    <Typography variant="h6" sx={{ flex: 1 }}>
                      {block.order}. {block.title}
                      {block.titleUk && (
                        <Typography component="span" variant="body2" color="text.secondary"> · {block.titleUk}</Typography>
                      )}
                    </Typography>
                    <Chip
                      label={block.mode === 'locked' ? 'Locked' : 'Choose one option'}
                      color={block.mode === 'locked' ? 'default' : 'primary'}
                      size="small"
                      variant="outlined"
                    />
                  </Box>
                  {block.rationale && (
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>{block.rationale}</Typography>
                  )}
                  {block.mode === 'locked' ? (
                    <Typography variant="body1" sx={{ lineHeight: 1.6 }}>{block.text}</Typography>
                  ) : (
                    <Stack component="ul" spacing={1} sx={{ pl: 3, m: 0 }}>
                      {(block.options || []).map((option) => (
                        <li key={option.key}>
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>{option.label}</Typography>
                          <Typography variant="body2" sx={{ lineHeight: 1.6 }}>{option.text}</Typography>
                        </li>
                      ))}
                    </Stack>
                  )}
                </CardContent>
              </Card>
            ))}
          </Stack>
        </Box>
      )}

      {/* Policy Viewer Dialog */}
      <Dialog
        open={!!selectedPolicy}
        onClose={() => setSelectedPolicy(null)}
        maxWidth="md"
        fullWidth
      >
        {selectedPolicy && (
          <>
            <DialogTitle>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Description />
                {selectedPolicy.title}
                <Chip
                  label={getTypeLabel(selectedPolicy.type)}
                  color={getTypeColor(selectedPolicy.type)}
                  size="small"
                  sx={{ ml: 1 }}
                />
              </Box>
            </DialogTitle>
            <DialogContent>
              <Box sx={{ mt: 2 }}>
                {selectedPolicy.contentType === 'markdown' ? (
                  <Box sx={{ 
                    '& h1': { fontSize: '2rem', mt: 2, mb: 1 },
                    '& h2': { fontSize: '1.5rem', mt: 2, mb: 1 },
                    '& h3': { fontSize: '1.25rem', mt: 2, mb: 1 },
                    '& p': { lineHeight: 1.6, mb: 1 },
                    '& ul, & ol': { pl: 3, mb: 2 },
                    '& code': { 
                      bgcolor: 'grey.100', 
                      p: 0.5, 
                      borderRadius: 0,
                      fontFamily: 'monospace'
                    },
                    '& pre': { 
                      bgcolor: 'grey.100', 
                      p: 2, 
                      borderRadius: 0,
                      overflow: 'auto'
                    }
                  }}>
                    <ReactMarkdown>{selectedPolicy.content}</ReactMarkdown>
                  </Box>
                ) : (
                  <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
                    {selectedPolicy.content}
                  </Typography>
                )}

                {selectedPolicy.attachedFile && (
                  <Box sx={{ mt: 3, p: 2, bgcolor: 'background.default', borderRadius: 0 }}>
                    <Typography variant="subtitle2" gutterBottom>
                      Attached file:
                    </Typography>
                    <Button
                      variant="outlined"
                      startIcon={<Download />}
                      onClick={() => handleDownloadFile(selectedPolicy._id)}
                      size="small"
                    >
                      {selectedPolicy.attachedFile.originalName}
                    </Button>
                  </Box>
                )}
              </Box>
            </DialogContent>
            <DialogActions>
              {isAdmin && (
                <Button
                  color="error"
                  startIcon={<Delete />}
                  onClick={() => setDeleteTarget(selectedPolicy)}
                >
                  Delete
                </Button>
              )}
              <Box sx={{ flexGrow: 1 }} />
              <Button onClick={() => setSelectedPolicy(null)}>Close</Button>
              {!selectedPolicy.isAcknowledged && (
                <Button
                  variant="contained"
                  color="success"
                  onClick={() => {
                    handleAcknowledge(selectedPolicy._id);
                    setSelectedPolicy(null);
                  }}
                  disabled={acknowledging}
                >
                  Acknowledge
                </Button>
              )}
            </DialogActions>
          </>
        )}
      </Dialog>

      <Dialog open={uploadOpen} onClose={() => !uploading && resetUploadForm()} maxWidth="sm" fullWidth>
        <DialogTitle>Upload document</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="Title"
              value={uploadForm.title}
              onChange={(event) => setUploadForm((form) => ({ ...form, title: event.target.value }))}
              disabled={uploading}
              fullWidth
              required
            />
            <TextField
              select
              label="Document type"
              value={uploadForm.type}
              onChange={(event) => setUploadForm((form) => ({ ...form, type: event.target.value }))}
              disabled={uploading}
              fullWidth
            >
              <MenuItem value="ai-policy">AI policy</MenuItem>
              <MenuItem value="academic-integrity">Academic integrity</MenuItem>
              <MenuItem value="teaching-tips">Teaching guidance</MenuItem>
            </TextField>
            <TextField
              label="Short description or Markdown text"
              value={uploadForm.content}
              onChange={(event) => setUploadForm((form) => ({ ...form, content: event.target.value }))}
              disabled={uploading}
              fullWidth
              multiline
              minRows={5}
              helperText="Optional when a file is attached."
            />
            <Button variant="outlined" component="label" startIcon={<UploadFile />} disabled={uploading}>
              {uploadForm.file ? uploadForm.file.name : "Choose a file"}
              <input
                hidden
                type="file"
                accept=".pdf,.doc,.docx,.txt,.md"
                onChange={(event) => {
                  const file = event.target.files?.[0] || null;
                  setUploadForm((form) => ({
                    ...form,
                    file,
                    title: form.title || file?.name?.replace(/\.[^.]+$/, '') || '',
                  }));
                }}
              />
            </Button>
            <FormControlLabel
              control={
                <Checkbox
                  checked={uploadForm.isRequired}
                  onChange={(event) => setUploadForm((form) => ({ ...form, isRequired: event.target.checked }))}
                  disabled={uploading}
                />
              }
              label="Require acknowledgement"
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={resetUploadForm} disabled={uploading}>Cancel</Button>
          <Button variant="contained" onClick={handleCreatePolicy} disabled={uploading}>
            {uploading ? "Loading…" : "Upload"}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!deleteTarget} onClose={() => !deleting && setDeleteTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete document?</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" color="text.secondary">
            The document “{deleteTarget?.title}” and its attachment will be permanently deleted.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)} disabled={deleting}>Cancel</Button>
          <Button color="error" variant="contained" onClick={handleDeletePolicy} disabled={deleting}>
            {deleting ? "Deleting…" : "Delete"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default PolicyReader;
