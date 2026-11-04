import React, { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Alert, Box, Button, Typography } from '@mui/material';
import api from '../../services/api';
import { USE_MOCKS } from '../../services/workspaceClient';
import { MOCK_PROGRAMS } from '../../mocks/chatV5';
import { useAuth } from '../../contexts/AuthContext';
import { useCohort } from '../../contexts/CohortContext';
import CohortSelect from '../../components/Cabinet/CohortSelect';
import CabinetShell from '../../components/Cabinet/CabinetShell';
import MetricsRow from './MetricsRow';
import SyllabiTab from './SyllabiTab';
import PloCoverageTab from './PloCoverageTab';
import CoursesCohortsTab from './CoursesCohortsTab';
import ReferenceLibraryTab from './ReferenceLibraryTab';
import UsersTab from './UsersTab';
import ProgramsTab from './ProgramsTab';
import { cabinetViewFor } from '../../utils/cabinetNavigation';

const Cabinet = () => {
  const { user } = useAuth();
  const { currentCohort } = useCohort();
  const [searchParams] = useSearchParams();
  const view = cabinetViewFor(user?.role || 'instructor', searchParams.get('view'));
  const [metrics, setMetrics] = useState(null);
  const [programs, setPrograms] = useState([]);
  const [error, setError] = useState('');
  const listView = ['my_syllabi', 'all_syllabi'].includes(view);
  const loadPrograms = useCallback(async () => {
    try { const { data } = await api.cabinet.listPrograms(); setPrograms(data || []); }
    catch { if (USE_MOCKS) setPrograms(MOCK_PROGRAMS); else setError('Could not load programmes. Please try again.'); }
  }, []);
  const loadMetrics = useCallback(() => {
    setMetrics(null);
    return api.cabinet.getMetrics({ scope: view === 'all_syllabi' ? 'all' : 'mine' }).then(({ data }) => setMetrics(data)).catch(() => setError('Could not load syllabus totals. Please try again.'));
  }, [view]);
  useEffect(() => { loadPrograms(); }, [loadPrograms]);
  useEffect(() => { if (listView) loadMetrics(); }, [listView, loadMetrics]);
  return <CabinetShell active={view} actions={view === 'my_syllabi' ? <Button component={Link} to="/workspace" variant="contained">+ New syllabus</Button> : null}>
    {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
    {listView && <MetricsRow metrics={metrics} />}
    {['all_syllabi', 'plo_coverage', 'courses_cohorts', 'outcomes'].includes(view) && <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 2, mb: 3 }}><Typography variant="body2" color="text.secondary">{view === 'all_syllabi' ? 'Course syllabi for the selected cohort.' : view === 'outcomes' ? 'Official programme outcomes and their English matrix labels.' : 'Select a cohort to explore its curriculum.'}</Typography><CohortSelect /></Box>}
    {listView && <SyllabiTab key={view} programs={programs} isAdmin={user?.role === 'admin'} user={user} filterMineOnly={view === 'my_syllabi'} programCode={view === 'all_syllabi' ? currentCohort : undefined} onChanged={loadMetrics} />}
    {view === 'plo_coverage' && <PloCoverageTab programCode={currentCohort} />}
    {view === 'courses_cohorts' && <CoursesCohortsTab programCode={currentCohort} />}
    {['policies', 'outcomes', 'assessment'].includes(view) && <ReferenceLibraryTab key={view} section={view} programCode={currentCohort} />}
    {view === 'users' && <UsersTab />}
    {view === 'programs' && <ProgramsTab programs={programs} reload={loadPrograms} />}
  </CabinetShell>;
};
export default Cabinet;
