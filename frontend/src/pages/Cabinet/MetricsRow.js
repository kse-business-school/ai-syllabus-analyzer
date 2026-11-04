import React from 'react';
import { Box, Typography } from '@mui/material';
const MetricsRow = ({ metrics }) => <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.25, mb: 3.5 }}>
  {[['Total syllabi', metrics?.total], ['100% ready', metrics?.ready100], ['Downloads', metrics?.downloads], ['In progress', metrics?.inProgress]].map(([label, value]) => <Box key={label} sx={{ display: 'flex', alignItems: 'stretch' }}><Box component="span" className="brand-plate" sx={{ fontSize: 10.5 }}>{label}</Box><Typography component="span" sx={{ px: 1.75, py: .75, fontSize: 15, fontWeight: 700, border: '1px solid', borderColor: 'divider' }}>{value ?? '—'}</Typography></Box>)}
</Box>;
export default MetricsRow;
