import React, { createContext, useContext, useMemo, useState } from 'react';

// Дані активного силабуса для верхньої панели (Readiness, Download .docx, відкриті перевірки).
// Workspace реєструє їх через setChrome і прибирає при виході зі сторінки.
const WorkspaceChromeContext = createContext({ chrome: null, setChrome: () => {} });

export const WorkspaceChromeProvider = ({ children }) => {
  const [chrome, setChrome] = useState(null);
  const value = useMemo(() => ({ chrome, setChrome }), [chrome]);
  return <WorkspaceChromeContext.Provider value={value}>{children}</WorkspaceChromeContext.Provider>;
};

export const useWorkspaceChrome = () => useContext(WorkspaceChromeContext);
