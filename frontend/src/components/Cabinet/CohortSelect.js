import React, { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import Typography from '@mui/material/Typography';
import api from '../../services/api';
import { useCohort } from '../../contexts/CohortContext';

// Перемикач набору — один на застосунок (ТЗ, доповнення 29.10 §4); значення — код редакції програми
const CohortSelect = () => {
  const { currentCohort, setCurrentCohort } = useCohort();
  const [editions, setEditions] = useState([]);

  useEffect(() => {
    let active = true;
    api.cabinet.listPrograms()
      .then(({ data }) => {
        if (!active) return;
        const list = (data || []).flatMap((p) => (p.editions || []).map((e) => ({ code: e.code, label: e.label || e.code })));
        setEditions(list);
        if (list.length && !list.some((e) => e.code === currentCohort)) setCurrentCohort(list[0].code);
      })
      .catch(() => {});
    return () => { active = false; };
  }, [currentCohort, setCurrentCohort]);

  if (!editions.length) return null;
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 700, letterSpacing: '0.04em' }}>COHORT</Typography>
      <Select
        size="small"
        value={editions.some((e) => e.code === currentCohort) ? currentCohort : ''}
        onChange={(e) => setCurrentCohort(e.target.value)}
        inputProps={{ 'aria-label': 'Cohort' }}
        sx={{ minWidth: 140, fontSize: '0.8125rem' }}
      >
        {editions.map((e) => <MenuItem key={e.code} value={e.code}>{e.label}</MenuItem>)}
      </Select>
    </Box>
  );
};

export default CohortSelect;
