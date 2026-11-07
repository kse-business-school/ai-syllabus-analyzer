import React, { createContext, useContext, useState, useEffect } from 'react';

const CohortContext = createContext();

const PROGRAM_KEY = 'kse_selected_program';
// Новий ключ: у старому лежав вигаданий 'Cohort 2026'
const COHORT_KEY = 'kse_selected_edition';

const read = (key, fallback) => {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
};

// currentCohort — код редакції програми (MBA27, MBA28…), за ним беруться ПРН, курси й призначення
export const CohortProvider = ({ children }) => {
  // Без дефолтної програми: перемикач набору сам обирає найновіший набір зі списку програм
  const [currentProgram, setCurrentProgram] = useState(() => read(PROGRAM_KEY, ''));
  const [currentCohort, setCurrentCohort] = useState(() => read(COHORT_KEY, ''));

  useEffect(() => {
    try { localStorage.setItem(PROGRAM_KEY, currentProgram); } catch { /* сховище недоступне */ }
  }, [currentProgram]);

  useEffect(() => {
    try { localStorage.setItem(COHORT_KEY, currentCohort); } catch { /* сховище недоступне */ }
  }, [currentCohort]);

  return (
    <CohortContext.Provider value={{ currentProgram, setCurrentProgram, currentCohort, setCurrentCohort }}>
      {children}
    </CohortContext.Provider>
  );
};

export const useCohort = () => useContext(CohortContext);
