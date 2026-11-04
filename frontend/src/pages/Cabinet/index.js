import React, { useCallback, useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import useMediaQuery from '@mui/material/useMediaQuery';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import MenuBookOutlined from '@mui/icons-material/MenuBookOutlined';
import GridViewOutlined from '@mui/icons-material/GridViewOutlined';
import LayersOutlined from '@mui/icons-material/LayersOutlined';
import LibraryBooksOutlined from '@mui/icons-material/LibraryBooksOutlined';
import PeopleOutline from '@mui/icons-material/PeopleOutline';
import SchoolOutlined from '@mui/icons-material/SchoolOutlined';

import api from '../../services/api';
import { USE_MOCKS } from '../../services/workspaceClient';
import { MOCK_PROGRAMS } from '../../mocks/chatV5';
import { useAuth } from '../../contexts/AuthContext';
import { useCohort } from '../../contexts/CohortContext';
import CohortSelect from '../../components/Cabinet/CohortSelect';
import MetricsRow from './MetricsRow';
import SyllabiTab from './SyllabiTab';
import PloCoverageTab from './PloCoverageTab';
import CoursesCohortsTab from './CoursesCohortsTab';
import ReferenceLibraryTab from './ReferenceLibraryTab';
import UsersTab from './UsersTab';
import ProgramsTab from './ProgramsTab';
import { ALL_ROLES, PROGRAMME_ROLES } from '../../utils/roles';

const NAV_ITEMS = [
  // Syllabi & Curriculum
  { id: 'my_syllabi', label: 'My syllabi', icon: <MenuBookOutlined fontSize="small" />, roles: ALL_ROLES },
  { id: 'all_syllabi', label: 'All syllabi', icon: <GridViewOutlined fontSize="small" />, roles: PROGRAMME_ROLES },
  { id: 'plo_coverage', label: 'PLO coverage', icon: <LayersOutlined fontSize="small" />, roles: PROGRAMME_ROLES },
  { id: 'courses_cohorts', label: 'Courses & cohorts', icon: <SchoolOutlined fontSize="small" />, roles: PROGRAMME_ROLES },
  // Reference Library
  { id: 'references', label: 'Reference library', icon: <LibraryBooksOutlined fontSize="small" />, roles: ALL_ROLES },
  // Administration
  { id: 'users', label: 'Users', icon: <PeopleOutline fontSize="small" />, roles: ['admin'] },
  { id: 'programs', label: 'Programmes', icon: <SchoolOutlined fontSize="small" />, roles: ['admin'] },
];

const Cabinet = () => {
  const { user } = useAuth();
  const { currentCohort } = useCohort();
  const isAdmin = user?.role === 'admin';
  const isDesktop = useMediaQuery('(min-width:1024px)');

  const [activeNav, setActiveNav] = useState('my_syllabi');
  const [metrics, setMetrics] = useState(null);
  const [programs, setPrograms] = useState([]);
  const [error, setError] = useState('');

  const availableNav = NAV_ITEMS.filter((item) => item.roles.includes(user?.role || 'instructor'));

  const loadPrograms = useCallback(async () => {
    try {
      const { data } = await api.cabinet.listPrograms();
      setPrograms(data || []);
    } catch {
      if (USE_MOCKS) {
        setPrograms(MOCK_PROGRAMS);
      } else {
        setError('Could not load programmes list.');
      }
    }
  }, []);

  const loadMetrics = useCallback(() => {
    api.cabinet.getMetrics().then(({ data }) => setMetrics(data)).catch(() => {});
  }, []);

  useEffect(() => {
    loadPrograms();
    loadMetrics();
  }, [loadPrograms, loadMetrics]);

  return (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Мобільні горизонтальні вкладки (< 1024px) */}
      {!isDesktop && (
        <Box sx={{ bgcolor: 'background.paper', borderBottom: '1px solid', borderColor: 'divider' }}>
          <Tabs
            value={availableNav.findIndex((n) => n.id === activeNav)}
            onChange={(_, idx) => setActiveNav(availableNav[idx].id)}
            variant="scrollable"
            scrollButtons="auto"
            sx={{ minHeight: 40 }}
          >
            {availableNav.map((item) => (
              <Tab
                key={item.id}
                label={item.label}
                icon={item.icon}
                iconPosition="start"
                sx={{ minHeight: 40, py: 0.5, fontSize: '0.8125rem', textTransform: 'none' }}
              />
            ))}
          </Tabs>
        </Box>
      )}

      <Box sx={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>
        {/* Десктопна ліва навігаційна колонка (220px) */}
        {isDesktop && (
          <Box
            sx={{
              width: 220,
              minWidth: 220,
              maxWidth: 220,
              borderRight: '1px solid',
              borderColor: 'divider',
              bgcolor: 'background.paper',
              display: 'flex',
              flexDirection: 'column',
              p: 1.5,
            }}
          >
            <Typography variant="caption" sx={{ color: 'text.muted', fontWeight: 700, px: 1, mb: 0.75, letterSpacing: '0.04em' }}>
              SYLLABI &amp; CURRICULUM
            </Typography>
            <List dense disablePadding sx={{ mb: 2 }}>
              {availableNav
                .filter((n) => ['my_syllabi', 'all_syllabi', 'plo_coverage', 'courses_cohorts'].includes(n.id))
                .map((item) => (
                  <ListItemButton
                    key={item.id}
                    selected={activeNav === item.id}
                    onClick={() => setActiveNav(item.id)}
                    sx={{
                      borderRadius: 1,
                      mb: 0.25,
                      py: 0.6,
                      px: 1.25,
                      '&.Mui-selected': { bgcolor: 'action.selected', fontWeight: 600 },
                    }}
                  >
                    <Box sx={{ mr: 1.25, display: 'flex', alignItems: 'center', color: activeNav === item.id ? 'primary.main' : 'text.secondary' }}>
                      {item.icon}
                    </Box>
                    <ListItemText
                      primary={item.label}
                      primaryTypographyProps={{
                        fontSize: '0.8125rem',
                        fontWeight: activeNav === item.id ? 600 : 500,
                      }}
                    />
                  </ListItemButton>
                ))}
            </List>

            <Typography variant="caption" sx={{ color: 'text.muted', fontWeight: 700, px: 1, mb: 0.75, letterSpacing: '0.04em' }}>
              KNOWLEDGE
            </Typography>
            <List dense disablePadding sx={{ mb: 2 }}>
              {availableNav
                .filter((n) => ['references'].includes(n.id))
                .map((item) => (
                  <ListItemButton
                    key={item.id}
                    selected={activeNav === item.id}
                    onClick={() => setActiveNav(item.id)}
                    sx={{
                      borderRadius: 1,
                      mb: 0.25,
                      py: 0.6,
                      px: 1.25,
                      '&.Mui-selected': { bgcolor: 'action.selected', fontWeight: 600 },
                    }}
                  >
                    <Box sx={{ mr: 1.25, display: 'flex', alignItems: 'center', color: activeNav === item.id ? 'primary.main' : 'text.secondary' }}>
                      {item.icon}
                    </Box>
                    <ListItemText
                      primary={item.label}
                      primaryTypographyProps={{
                        fontSize: '0.8125rem',
                        fontWeight: activeNav === item.id ? 600 : 500,
                      }}
                    />
                  </ListItemButton>
                ))}
            </List>

            {isAdmin && (
              <>
                <Typography variant="caption" sx={{ color: 'text.muted', fontWeight: 700, px: 1, mb: 0.75, letterSpacing: '0.04em' }}>
                  ADMINISTRATION
                </Typography>
                <List dense disablePadding>
                  {availableNav
                    .filter((n) => ['users', 'programs'].includes(n.id))
                    .map((item) => (
                      <ListItemButton
                        key={item.id}
                        selected={activeNav === item.id}
                        onClick={() => setActiveNav(item.id)}
                        sx={{
                          borderRadius: 1,
                          mb: 0.25,
                          py: 0.6,
                          px: 1.25,
                          '&.Mui-selected': { bgcolor: 'action.selected', fontWeight: 600 },
                        }}
                      >
                        <Box sx={{ mr: 1.25, display: 'flex', alignItems: 'center', color: activeNav === item.id ? 'primary.main' : 'text.secondary' }}>
                          {item.icon}
                        </Box>
                        <ListItemText
                          primary={item.label}
                          primaryTypographyProps={{
                            fontSize: '0.8125rem',
                            fontWeight: activeNav === item.id ? 600 : 500,
                          }}
                        />
                      </ListItemButton>
                    ))}
                </List>
              </>
            )}
          </Box>
        )}

        {/* Основна контентна зона */}
        <Box sx={{ flex: 1, overflowY: 'auto', p: { xs: 2, md: 3 } }}>
          <Box sx={{ maxWidth: 1080, mx: 'auto' }}>
            {/* Рядок метрик зверху */}
            <MetricsRow metrics={metrics} />

            {error && <Alert severity="error" sx={{ mb: 2, borderRadius: 1 }}>{error}</Alert>}

            {/* Перемикач набору — лише на екранах, де набір має значення */}
            {['plo_coverage', 'courses_cohorts', 'references'].includes(activeNav) && (
              <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
                <CohortSelect />
              </Box>
            )}

            {/* Вміст обраного розділу */}
            {activeNav === 'my_syllabi' && (
              <SyllabiTab
                programs={programs}
                isAdmin={isAdmin}
                user={user}
                filterMineOnly={true}
                onChanged={loadMetrics}
              />
            )}

            {activeNav === 'all_syllabi' && PROGRAMME_ROLES.includes(user?.role) && (
              <SyllabiTab
                programs={programs}
                isAdmin={isAdmin}
                user={user}
                filterMineOnly={false}
                onChanged={loadMetrics}
              />
            )}

            {activeNav === 'plo_coverage' && (
              <PloCoverageTab programCode={currentCohort} />
            )}

            {activeNav === 'courses_cohorts' && (
              <CoursesCohortsTab programCode={currentCohort} />
            )}

            {activeNav === 'references' && (
              <ReferenceLibraryTab programCode={currentCohort} />
            )}

            {activeNav === 'users' && isAdmin && <UsersTab />}

            {activeNav === 'programs' && isAdmin && (
              <ProgramsTab programs={programs} reload={loadPrograms} />
            )}
          </Box>
        </Box>
      </Box>
    </Box>
  );
};

export default Cabinet;
