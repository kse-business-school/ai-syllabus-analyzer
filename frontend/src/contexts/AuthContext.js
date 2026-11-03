import React, { createContext, useContext, useReducer, useEffect } from 'react';
import api from '../services/api';

const AuthContext = createContext();

const initialState = {
  user: null,
  token: localStorage.getItem('token'),
  isAuthenticated: false,
  isLoading: true,
};

const authReducer = (state, action) => {
  switch (action.type) {
    case 'SET_LOADING':
      return {
        ...state,
        isLoading: action.payload,
      };
    case 'LOGIN_SUCCESS':
      return {
        ...state,
        user: action.payload.user,
        token: action.payload.token,
        isAuthenticated: true,
        isLoading: false,
      };
    case 'LOGOUT':
      return {
        ...state,
        user: null,
        token: null,
        isAuthenticated: false,
        isLoading: false,
      };
    case 'UPDATE_USER':
      return {
        ...state,
        user: { ...state.user, ...action.payload },
      };
    case 'SET_USER':
      return {
        ...state,
        user: action.payload,
        isAuthenticated: true,
        isLoading: false,
      };
    default:
      return state;
  }
};

// Dev-обхід входу: лише з REACT_APP_USE_MOCKS=1 (у проді змінної немає).
// Роль можна вибрати через ?role=instructor|admin; вибір лишається в sessionStorage.
const USE_MOCKS = process.env.REACT_APP_USE_MOCKS === '1';
const MOCK_ROLES = ['instructor', 'admin'];

const getMockUser = () => {
  let role = 'instructor';
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('role');
    if (MOCK_ROLES.includes(fromUrl)) sessionStorage.setItem('mockRole', fromUrl);
    const stored = sessionStorage.getItem('mockRole');
    if (MOCK_ROLES.includes(stored)) role = stored;
  } catch { /* sessionStorage недоступний — лишається instructor */ }
  return {
    id: `mock-${role}`,
    email: `${role}@mock.local`,
    firstName: 'Demo',
    lastName: role === 'admin' ? 'Admin' : 'Instructor',
    role,
    settings: { theme: 'system' },
  };
};

// Очищуємо кеш вкладок, щоб наступний користувач браузера не бачив чужих силабусів.
const clearWorkspaceTabCaches = () => {
  try {
    const stale = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (k && k.startsWith('pt.openTabs.v1')) stale.push(k);
    }
    stale.forEach((k) => localStorage.removeItem(k));
  } catch { /* ігноруємо помилки квоти або приватного режиму */ }
};

export const AuthProvider = ({ children }) => {
  const [state, dispatch] = useReducer(authReducer, initialState);

  useEffect(() => {
    const initializeAuth = async () => {
      if (USE_MOCKS) {
        dispatch({ type: 'SET_USER', payload: getMockUser() });
        return;
      }
      const token = localStorage.getItem('token');

      if (token) {
        try {
          const response = await api.auth.getProfile();
          dispatch({
            type: 'SET_USER',
            payload: response.data.user,
          });
        } catch (error) {
          console.error('Auth initialization failed:', error);
          localStorage.removeItem('token');
          clearWorkspaceTabCaches();
          dispatch({ type: 'LOGOUT' });
        }
      } else {
        dispatch({ type: 'SET_LOADING', payload: false });
      }
    };

    // Автоматичний вихід після помилки 401
    const handleAuthLogout = () => {
      clearWorkspaceTabCaches();
      dispatch({ type: 'LOGOUT' });
    };

    window.addEventListener('auth_logout', handleAuthLogout);
    initializeAuth();

    return () => {
      window.removeEventListener('auth_logout', handleAuthLogout);
    };
  }, []);

  const login = async (email, password) => {
    try {
      // Не вмикаємо глобальний isLoading під час входу, щоб не розмонтувати <App />
      // і не втратити введені дані та повідомлення про помилку.
      const response = await api.auth.login(email, password);
      const { user, token } = response.data;

      localStorage.setItem('token', token);

      dispatch({
        type: 'LOGIN_SUCCESS',
        payload: { user, token },
      });

      return { success: true };
    } catch (error) {
      const errorMessage = error.response?.data?.message || "Sign-in failed";
      throw new Error(errorMessage);
    }
  };

  const logout = () => {
    localStorage.removeItem('token');
    clearWorkspaceTabCaches();
    dispatch({ type: 'LOGOUT' });
  };

  const updateProfile = async (profileData) => {
    try {
      const response = await api.auth.updateProfile(profileData);
      dispatch({
        type: 'UPDATE_USER',
        payload: response.data.user,
      });
      return { success: true };
    } catch (error) {
      const errorMessage = error.response?.data?.message || "Could not update your profile";
      return { success: false, error: errorMessage };
    }
  };

  const forgotPassword = async (email) => {
    try {
      await api.auth.forgotPassword(email);
      return { success: true };
    } catch (error) {
      const errorMessage = error.response?.data?.message || "Could not request a password reset";
      return { success: false, error: errorMessage };
    }
  };

  const resetPassword = async (token, password) => {
    try {
      await api.auth.resetPassword(token, password);
      return { success: true };
    } catch (error) {
      const errorMessage = error.response?.data?.message || "Could not reset your password";
      return { success: false, error: errorMessage };
    }
  };

  const changePassword = async (currentPassword, newPassword) => {
    try {
      await api.user.changePassword(currentPassword, newPassword);
      return { success: true };
    } catch (error) {
      const errorMessage = error.response?.data?.message || "Could not change your password";
      return { success: false, error: errorMessage };
    }
  };

  const deleteAccount = async (password) => {
    try {
      await api.user.deleteAccount(password);
      logout();
      return { success: true };
    } catch (error) {
      const errorMessage = error.response?.data?.message || "Could not delete your account";
      return { success: false, error: errorMessage };
    }
  };

  const value = {
    user: state.user,
    token: state.token,
    isAuthenticated: state.isAuthenticated,
    isLoading: state.isLoading,
    login,
    logout,
    updateProfile,
    forgotPassword,
    resetPassword,
    changePassword,
    deleteAccount,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export default AuthContext;
