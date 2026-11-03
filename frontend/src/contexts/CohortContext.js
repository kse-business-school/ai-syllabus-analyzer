import React, { createContext, useContext, useState, useEffect } from 'react';

const CohortContext = createContext();

export const CohortProvider = ({ children }) => {
  const [currentProgram, setCurrentProgram] = useState(() => {
    return localStorage.getItem('kse_selected_program') || 'MBA';
  });

  const [currentCohort, setCurrentCohort] = useState(() => {
    return localStorage.getItem('kse_selected_cohort') || 'Cohort 2026';
  });

  useEffect(() => {
    localStorage.setItem('kse_selected_program', currentProgram);
  }, [currentProgram]);

  useEffect(() => {
    localStorage.setItem('kse_selected_cohort', currentCohort);
  }, [currentCohort]);

  return (
    <CohortContext.Provider
      value={{
        currentProgram,
        setCurrentProgram,
        currentCohort,
        setCurrentCohort,
      }}
    >
      {children}
    </CohortContext.Provider>
  );
};

export const useCohort = () => useContext(CohortContext);
