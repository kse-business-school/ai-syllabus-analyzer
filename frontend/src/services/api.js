import axios from 'axios';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

// Виклики LLM можуть тривати до двох хвилин.
const LLM_REQUEST = { timeout: 130000 };

class ApiService {
  constructor() {
    this.client = axios.create({
      baseURL: API_BASE_URL,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    this.client.interceptors.request.use(
      (config) => {
        const token = localStorage.getItem('token');
        if (token) {
          config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
      },
      (error) => Promise.reject(error)
    );

    this.client.interceptors.response.use(
      (response) => response,
      async (error) => {
        const cfg = error.config || {};
        const status = error.response?.status;

        if (status === 401 && !cfg.url?.includes('/auth/login')) {
          localStorage.removeItem('token');
          window.dispatchEvent(new CustomEvent('auth_logout'));
        }

        const isGet = (cfg.method || 'get').toLowerCase() === 'get';
        if (status === 429 && isGet) {
          cfg.__retryCount = cfg.__retryCount || 0;
        }
        if (status === 429 && isGet && cfg.__retryCount < 3) {
          cfg.__retryCount += 1;
          const retryAfterHeader = error.response?.headers?.['retry-after'];
          const serverDelay = retryAfterHeader ? parseInt(retryAfterHeader, 10) * 1000 : null;
          const backoff = serverDelay ?? Math.min(2000 * cfg.__retryCount, 5000);
          await new Promise((r) => setTimeout(r, backoff));
          return this.client(cfg);
        }

        return Promise.reject(error);
      }
    );
  }

  // Auth endpoints
  auth = {
    login: (email, password) => this.client.post('/auth/login', { email, password }),
    getProfile: () => this.client.get('/auth/profile'),
    updateProfile: (data) => this.client.put('/auth/profile', data),
    forgotPassword: (email) => this.client.post('/auth/forgot-password', { email }),
    resetPassword: (token, password) => this.client.post('/auth/reset-password', { token, password }),
    logout: () => this.client.post('/auth/logout'),
  };

  user = {
    changePassword: (currentPassword, newPassword) =>
      this.client.put('/users/change-password', { currentPassword, newPassword }),
    deleteAccount: (password) =>
      this.client.delete('/users/account', { data: { password } }),
    updateSettings: (data) => this.client.put('/users/settings', data),
  };

  emailChange = {
    request: (newEmail) => this.client.post('/users/email-change/request', { newEmail }),
    confirm: (token) => this.client.post('/users/email-change/confirm', { token }),
  };

  syllabus = {
    // Трек 1: { title, programId, programCode, courseCode? } → { syllabus }
    create: (data) => this.client.post('/syllabus', data),
    // Трек 2: multipart (поле `syllabus` — файл, `courseName`, `programId`, `programCode`)
    upload: (formData, config = {}) =>
      this.client.post('/syllabus/upload', formData, {
        ...config,
        headers: { 'Content-Type': 'multipart/form-data', ...(config.headers || {}) },
      }),
    // Опитування під час аналізу: { status, stage, error }
    getStatus: (id) => this.client.get(`/syllabus/${id}/status`),
    deleteSyllabus: (id) => this.client.delete(`/syllabus/${id}`),
    // Повторний парсинг або перебудова v4 → v5 (needsRebuild)
    reanalyze: (id) => this.client.post(`/syllabus/${id}/analyze`),
  };

  // Контракт: docs/api-v5.md §6. Кожна мутація повертає повний View.
  chat = {
    get: (syllabusId) => this.client.get(`/chat/${syllabusId}`),
    start: (syllabusId) => this.client.post(`/chat/${syllabusId}/start`, {}, LLM_REQUEST),
    // Права панель: { sections: [{ key, docNumber, title, blocks }] }; diff=1 — parts проти baselineState
    document: (syllabusId, { diff = false } = {}) =>
      this.client.get(`/chat/${syllabusId}/document`, { params: { diff: diff ? 1 : 0 } }),
    approveSection: (syllabusId, key) => this.client.post(`/chat/${syllabusId}/sections/${key}/approve`),
    unapproveSection: (syllabusId, key) => this.client.delete(`/chat/${syllabusId}/sections/${key}/approve`),
    // { approved: [key], skipped: [{ key, reason }] } + View
    approveAll: (syllabusId, body = {}) => this.client.post(`/chat/${syllabusId}/sections/approve-all`, body),
    // body: { optionKey } або { writeOwn: true }
    choosePolicy: (syllabusId, key, body) =>
      this.client.post(`/chat/${syllabusId}/policies/${encodeURIComponent(key)}/choose`, body, LLM_REQUEST),
    // body: { optionId?, expectedRevision }
    accept: (syllabusId, suggestionId, body = {}) =>
      this.client.post(`/chat/${syllabusId}/suggestions/${suggestionId}/accept`, body, LLM_REQUEST),
    // «Change the value»: { values: [{ id, value, confirmed }] }
    setValues: (syllabusId, suggestionId, values) =>
      this.client.post(`/chat/${syllabusId}/suggestions/${suggestionId}/values`, { values }),
    reject: (syllabusId, suggestionId, body = {}) =>
      this.client.post(`/chat/${syllabusId}/suggestions/${suggestionId}/reject`, body, LLM_REQUEST),
    refine: (syllabusId, suggestionId, body = {}) =>
      this.client.post(`/chat/${syllabusId}/suggestions/${suggestionId}/refine`, body, LLM_REQUEST),
    answer: (syllabusId, suggestionId, answer) =>
      this.client.post(`/chat/${syllabusId}/suggestions/${suggestionId}/answer`, { answer }, LLM_REQUEST),
    reopen: (syllabusId, suggestionId) =>
      this.client.post(`/chat/${syllabusId}/suggestions/${suggestionId}/reopen`, {}, LLM_REQUEST),
    sendMessage: (syllabusId, text, options = {}) =>
      this.client.post(`/chat/${syllabusId}/message`, { text }, { ...LLM_REQUEST, ...options }),
    skip: (syllabusId, slotKey) => this.client.post(`/chat/${syllabusId}/skip`, { slotKey }, LLM_REQUEST),
    // Один вихід — syllabus.docx; ім'я файлу з Content-Disposition
    downloadDocx: (syllabusId) =>
      this.client.get(`/chat/${syllabusId}/outputs/syllabus.docx`, { ...LLM_REQUEST, responseType: 'blob' }),
  };

  cabinet = {
    getSyllabi: (params = {}) => this.client.get('/cabinet/syllabi', { params }),
    getMetrics: () => this.client.get('/cabinet/metrics'),
    getUsers: (params = {}) => this.client.get('/cabinet/users', { params }),
    createUser: (data) => this.client.post('/cabinet/users', data),
    listPrograms: () => this.client.get('/cabinet/programs'),
    createProgram: (data) => this.client.post('/cabinet/programs', data),
    updateProgram: (id, data) => this.client.put(`/cabinet/programs/${id}`, data),
    deleteProgram: (id) => this.client.delete(`/cabinet/programs/${id}`),
    updateUser: (id, data) => this.client.patch(`/cabinet/users/${id}`, data),
  };

  // Довідники v5 за programCode
  references = {
    programs: () => this.client.get('/references/programs'),
    template: (programCode) => this.client.get(`/references/${programCode}/template`),
    outcomes: (programCode) => this.client.get(`/references/${programCode}/outcomes`),
    courses: (programCode) => this.client.get(`/references/${programCode}/courses`),
    capstone: (programCode) => this.client.get(`/references/${programCode}/capstone`),
  };

  // Профіль викладача до інтеграції Lecturers CRM
  lecturerProfile = {
    get: () => this.client.get('/users/profile/lecturer'),
    update: (data) => this.client.put('/users/profile/lecturer', data),
  };

  policies = {
    getAll: (params = {}) => this.client.get('/policies', { params }),
    // Довідник політик силабуса: { policies: [{ key, title, mode, options[{ key, label, text }], text, rationale }] }
    syllabusLibrary: () => this.client.get('/policies', { params: { type: 'syllabus-policy' } }),
    create: (data) =>
      this.client.post('/policies', data, {
        headers: { 'Content-Type': 'multipart/form-data' },
      }),
    update: (id, data) =>
      this.client.put(`/policies/${id}`, data, {
        headers: { 'Content-Type': 'multipart/form-data' },
      }),
    delete: (id) => this.client.delete(`/policies/${id}`),
    acknowledge: (id) => this.client.post(`/policies/${id}/acknowledge`),
    downloadFile: (id) => this.client.get(`/policies/${id}/download`, { responseType: 'blob' }),
  };
}

const api = new ApiService();
export default api;
