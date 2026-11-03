import React, { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import Accordion from '@mui/material/Accordion';
import AccordionSummary from '@mui/material/AccordionSummary';
import AccordionDetails from '@mui/material/AccordionDetails';
import ExpandMore from '@mui/icons-material/ExpandMore';
import Chip from '@mui/material/Chip';
import api from '../../services/api';

const ReferenceLibraryTab = ({ programCode = 'MBA' }) => {
  const [subTab, setSubTab] = useState(0); // 0: Policies, 1: Outcomes, 2: Assessment
  const [policies, setPolicies] = useState([]);
  const [outcomes, setOutcomes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');

    Promise.all([
      api.policies.syllabusLibrary().catch(() => ({ data: { policies: [] } })),
      api.references.outcomes(programCode).catch(() => ({ data: { outcomes: [] } })),
      api.references.template(programCode).catch(() => ({ data: null })),
    ])
      .then(([polRes, outRes]) => {
        if (!active) return;
        setPolicies(polRes.data?.policies || []);
        setOutcomes(outRes.data?.outcomes || []);
      })
      .catch((err) => {
        if (active) setError('Could not load reference library items.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [programCode]);

  return (
    <Box>
      <Box sx={{ mb: 2 }}>
        <Typography variant="h2" sx={{ fontSize: '0.9375rem', fontWeight: 600, mb: 0.5 }}>
          Institutional Reference Library
        </Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary', fontSize: '0.8125rem' }}>
          Official academic policies, competency benchmarks, and grading standards for {programCode}.
        </Typography>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2, borderRadius: 1 }}>{error}</Alert>}

      <Tabs
        value={subTab}
        onChange={(_, val) => setSubTab(val)}
        sx={{
          mb: 2.5,
          borderBottom: '1px solid',
          borderColor: 'divider',
          '& .MuiTab-root': {
            fontSize: '0.8125rem',
            textTransform: 'none',
            fontWeight: 500,
            py: 0.75,
          },
        }}
      >
        <Tab label="Course Policies" />
        <Tab label="Programme Outcomes" />
        <Tab label="Assessment Components" />
      </Tabs>

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress size={28} />
        </Box>
      ) : subTab === 0 ? (
        /* Subtab 0: Course Policies */
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          {policies.map((pol) => (
            <Accordion key={pol.key || pol.id} variant="outlined" sx={{ borderColor: 'divider' }}>
              <AccordionSummary expandIcon={<ExpandMore />}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flex: 1 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600, fontSize: '0.875rem' }}>
                    {pol.title}
                  </Typography>
                  <Chip
                    label={pol.mode === 'locked' ? 'Institutional standard' : `${pol.options?.length || 0} presets`}
                    size="small"
                    variant="outlined"
                    sx={{ height: 18, fontSize: '0.6875rem' }}
                  />
                </Box>
              </AccordionSummary>
              <AccordionDetails sx={{ pt: 0, pb: 2 }}>
                {pol.rationale && (
                  <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1.5 }}>
                    Rationale: {pol.rationale}
                  </Typography>
                )}
                {pol.text && (
                  <Paper variant="outlined" sx={{ p: 1.5, bgcolor: 'background.default', mb: 1 }}>
                    <Typography variant="body2" sx={{ fontSize: '0.8125rem' }}>{pol.text}</Typography>
                  </Paper>
                )}
                {pol.options?.map((opt) => (
                  <Paper key={opt.key} variant="outlined" sx={{ p: 1.5, mb: 1, bgcolor: 'background.paper' }}>
                    <Typography variant="body2" sx={{ fontWeight: 600, fontSize: '0.8125rem', mb: 0.5 }}>
                      {opt.label}
                    </Typography>
                    <Typography variant="body2" sx={{ fontSize: '0.8125rem', color: 'text.secondary' }}>
                      {opt.text}
                    </Typography>
                  </Paper>
                ))}
              </AccordionDetails>
            </Accordion>
          ))}
        </Box>
      ) : subTab === 1 ? (
        /* Subtab 1: Programme Outcomes */
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          {outcomes.map((out, idx) => (
            <Paper key={out.code || idx} variant="outlined" sx={{ p: 2, borderColor: 'divider' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
                <Chip
                  label={out.code || `PLO ${idx + 1}`}
                  size="small"
                  color="primary"
                  sx={{ height: 20, fontSize: '0.6875rem', fontWeight: 700 }}
                />
                <Typography variant="body2" sx={{ fontWeight: 600, fontSize: '0.875rem' }}>
                  {out.title || out.code}
                </Typography>
              </Box>
              <Typography variant="body2" sx={{ color: 'text.secondary', fontSize: '0.8125rem', lineHeight: 1.55 }}>
                {out.description || 'Institutional outcome description and rubric.'}
              </Typography>
            </Paper>
          ))}
        </Box>
      ) : (
        /* Subtab 2: Assessment Components */
        <Paper variant="outlined" sx={{ p: 3, borderColor: 'divider' }}>
          <Typography variant="h2" sx={{ fontSize: '0.9375rem', fontWeight: 600, mb: 1 }}>
            Standard Assessment Framework
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', fontSize: '0.8125rem', mb: 2 }}>
            KSE requires assessment weights to sum exactly to 100%. Individual assignment weights must not exceed 40% without academic director approval.
          </Typography>
          <Box sx={{ bgcolor: 'background.default', p: 2, borderRadius: 1, border: '1px solid', borderColor: 'divider' }}>
            <Typography variant="caption" sx={{ fontWeight: 600, display: 'block', mb: 1 }}>
              Passing Threshold Rule:
            </Typography>
            <Typography variant="body2" sx={{ fontSize: '0.8125rem' }}>
              To pass the course, a student must earn at least 60 out of 100 points across all graded components.
            </Typography>
          </Box>
        </Paper>
      )}
    </Box>
  );
};

export default ReferenceLibraryTab;
