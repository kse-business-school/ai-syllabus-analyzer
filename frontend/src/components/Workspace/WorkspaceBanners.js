import React, { useState, useEffect } from 'react';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Box from '@mui/material/Box';
import WifiOffOutlined from '@mui/icons-material/WifiOffOutlined';
import { S } from '../../strings';

const WorkspaceBanners = ({ syllabus, isReadOnlyAdmin, busy, onRebuild, onUploadAgain }) => {
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column' }}>
      {!isOnline && (
        <Alert
          severity="warning"
          icon={<WifiOffOutlined fontSize="small" />}
          sx={{ borderRadius: 0, py: 0.5 }}
        >
          You&apos;re offline. Messages will send when you reconnect.
        </Alert>
      )}

      {syllabus?.needsRebuild && (
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

      {syllabus?.legacy && (
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

      {(isReadOnlyAdmin || syllabus?.canMutate === false) && (
        <Alert severity="info" sx={{ borderRadius: 0, py: 0.5 }}>
          {S.readOnlyBanner}
        </Alert>
      )}
    </Box>
  );
};

export default WorkspaceBanners;
