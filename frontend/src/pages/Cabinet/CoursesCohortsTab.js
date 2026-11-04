import React, { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';
import { USE_MOCKS } from '../../services/workspaceClient';

const CoursesCohortsTab = ({ programCode = 'MBA' }) => {
  const navigate = useNavigate();
  const [courses, setCourses] = useState([]);
  const [syllabi, setSyllabi] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([
      api.references.courses(programCode).catch(() => ({ data: [] })),
      api.cabinet.getSyllabi({ program: programCode, limit: 100 }).catch(() => ({ data: { syllabi: [] } })),
    ])
      .then(([crsRes, sylRes]) => {
        if (!active) return;
        const crsList = crsRes.data?.courses || (Array.isArray(crsRes.data) ? crsRes.data : []);
        const sylList = sylRes.data?.syllabi || [];
        setCourses(crsList);
        setSyllabi(sylList);
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
          Courses &amp; Cohort Catalog
        </Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary', fontSize: '0.8125rem' }}>
          Overview of accredited courses and active syllabus assignments for {programCode}.
        </Typography>
      </Box>

      {USE_MOCKS && (
        <Alert severity="info" sx={{ mb: 2, py: 0.5 }}>
          <Chip label="Demo data" size="small" color="warning" sx={{ mr: 1, height: 18, fontSize: '0.6875rem' }} />
          Showing sample curriculum cohort catalog.
        </Alert>
      )}

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress size={28} />
        </Box>
      ) : courses.length === 0 ? (
        <Alert severity="warning">No courses configured for programme {programCode}.</Alert>
      ) : (
        <TableContainer component={Paper} variant="outlined" sx={{ borderColor: 'divider' }}>
          <Table size="small">
            <TableHead sx={{ bgcolor: 'background.default' }}>
              <TableRow>
                <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem', py: 1 }}>Course Code</TableCell>
                <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem', py: 1 }}>Course Name</TableCell>
                <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem', py: 1 }}>Credits / ECTS</TableCell>
                <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem', py: 1 }}>Active Syllabus</TableCell>
                <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem', py: 1, textAlign: 'right' }}>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {courses.map((course) => {
                const matchedSyllabus = syllabi.find(
                  (s) =>
                    (s.courseCode && s.courseCode === course.code) ||
                    (s.title && s.title.toLowerCase().includes((course.name || '').toLowerCase()))
                );

                return (
                  <TableRow key={course.code || course.id} hover>
                    <TableCell sx={{ py: 1.25, fontWeight: 600, fontSize: '0.8125rem' }}>
                      {course.code || '—'}
                    </TableCell>
                    <TableCell sx={{ py: 1.25, fontSize: '0.8125rem' }}>
                      <Typography variant="body2" sx={{ fontWeight: 600, fontSize: '0.8125rem' }}>
                        {course.name || course.title}
                      </Typography>
                    </TableCell>
                    <TableCell sx={{ py: 1.25, fontSize: '0.8125rem' }}>
                      {course.credits || course.ects || '3.0'} ECTS
                    </TableCell>
                    <TableCell sx={{ py: 1.25 }}>
                      {matchedSyllabus ? (
                        <Chip
                          label={`Ready (${matchedSyllabus.readiness?.score || 0}%)`}
                          size="small"
                          color={matchedSyllabus.readiness?.score >= 80 ? 'success' : 'warning'}
                          sx={{ height: 20, fontSize: '0.6875rem', fontWeight: 600 }}
                        />
                      ) : (
                        <Chip
                          label="Not started"
                          size="small"
                          variant="outlined"
                          sx={{ height: 20, fontSize: '0.6875rem', color: 'text.secondary' }}
                        />
                      )}
                    </TableCell>
                    <TableCell align="right" sx={{ py: 1.25 }}>
                      {matchedSyllabus ? (
                        <Button
                          size="small"
                          variant="text"
                          onClick={() => navigate(`/workspace/${matchedSyllabus._id || matchedSyllabus.id}`)}
                          sx={{ fontSize: '0.75rem', py: 0.2 }}
                        >
                          Open
                        </Button>
                      ) : (
                        <Button
                          size="small"
                          variant="outlined"
                          onClick={() => navigate('/workspace')}
                          sx={{ fontSize: '0.75rem', py: 0.2 }}
                        >
                          Draft
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  );
};

export default CoursesCohortsTab;
