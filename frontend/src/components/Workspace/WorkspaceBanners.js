import React from 'react';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Box from '@mui/material/Box';
import { S } from '../../strings';

const WorkspaceBanners = ({ syllabus, isReadOnlyAdmin, busy, onRebuild, onUploadAgain }) => {
  if (!syllabus) return null;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column' }}>
      {syllabus.needsRebuild && (
        <Alert
          severity="warning"
          sx={{ borderRadius: 0, py: 0.5 }}
          action={
            onRebuild && (
              <Button color="inherit" size="small" disabled={busy} onClick={onRebuild}>
                {S.rebuild}
              </Button>
            )
          }
        >
          {S.rebuildBanner}
        </Alert>
      )}

      {syllabus.legacy && (
        <Alert
          severity="warning"
          sx={{ borderRadius: 0, py: 0.5 }}
          action={
            <Button color="inherit" size="small" onClick={onUploadAgain}>
              {S.uploadAgain}
            </Button>
          }
        >
          {S.legacyBanner}
        </Alert>
      )}

      {(isReadOnlyAdmin || syllabus.canMutate === false) && (
        <Alert severity="info" sx={{ borderRadius: 0, py: 0.5 }}>
          {S.readOnlyBanner}
        </Alert>
      )}
    </Box>
  );
};

export default WorkspaceBanners;
