import React, { useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import LinearProgress from '@mui/material/LinearProgress';
import Step from '@mui/material/Step';
import StepLabel from '@mui/material/StepLabel';
import Stepper from '@mui/material/Stepper';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import { ANALYSIS_STAGES, S } from '../../strings';

const AnalysisProgress = ({ stage, error, failed, timedOut, busy, onRetry, onSkipToWorkspace }) => {
  const narrow = useMediaQuery(useTheme().breakpoints.down('sm'));
  const [secondsElapsed, setSecondsElapsed] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setSecondsElapsed((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  if (failed || timedOut) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', mt: 8, gap: 2.5, px: 2 }}>
        <Alert severity="error" sx={{ maxWidth: 560, width: '100%', borderRadius: 1.5 }}>
          {failed
            ? `${S.analysisFailed}${error ? ` (${error})` : ''}`
            : S.analysisTimedOut}
        </Alert>
        <Box sx={{ display: 'flex', gap: 1.5 }}>
          {onRetry && (
            <Button variant="contained" onClick={onRetry} disabled={busy}>
              {S.retryAnalysis}
            </Button>
          )}
          {onSkipToWorkspace && (
            <Button variant="outlined" onClick={onSkipToWorkspace}>
              Open workspace anyway
            </Button>
          )}
        </Box>
      </Box>
    );
  }

  const index = ANALYSIS_STAGES.findIndex((s) => s.key === stage);
  const last = ANALYSIS_STAGES.length - 1;
  const activeStep = index === last ? ANALYSIS_STAGES.length : Math.max(0, index);
  const percent = index < 0 ? 15 : Math.round(((index + 1) / (last + 1)) * 100);

  return (
    <Box sx={{ maxWidth: 700, mx: 'auto', mt: { xs: 4, md: 8 }, px: 2.5 }}>
      <Typography
        variant="h1"
        align="center"
        sx={{ fontSize: '1.25rem', fontWeight: 600, mb: 1, letterSpacing: '-0.01em' }}
      >
        {S.analyzingTitle}
      </Typography>
      <Typography variant="body2" color="text.secondary" align="center" sx={{ mb: 4, maxWidth: 520, mx: 'auto' }}>
        {secondsElapsed > 25
          ? 'Large syllabi take up to a minute to cross-check against programme outcomes.'
          : S.analyzingHint}
      </Typography>

      <Stepper
        activeStep={activeStep}
        alternativeLabel={!narrow}
        orientation={narrow ? 'vertical' : 'horizontal'}
        sx={{
          mb: 4,
          '& .MuiStepLabel-label': {
            fontSize: '0.75rem',
            fontWeight: 500,
            mt: 0.5,
          },
        }}
      >
        {ANALYSIS_STAGES.map((s) => (
          <Step key={s.key}>
            <StepLabel>{s.label}</StepLabel>
          </Step>
        ))}
      </Stepper>

      <Box sx={{ mb: 2 }}>
        <LinearProgress
          variant={index < 0 ? 'indeterminate' : 'determinate'}
          value={percent}
          sx={{ height: 6, borderRadius: 999 }}
          aria-label={S.analysisProgress}
        />
      </Box>

      <Typography variant="caption" color="text.muted" align="center" sx={{ display: 'block' }}>
        Elapsed: {secondsElapsed}s
      </Typography>
    </Box>
  );
};

export default AnalysisProgress;
