import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import defaultClient from '../services/workspaceClient';
import { describeError } from '../utils/apiError';
import { docxFallbackName, filenameFromDisposition, saveBlob } from '../utils/files';
import { S } from '../strings';

export const ANALYSIS_POLL_INTERVAL_MS = 5000;
export const ANALYSIS_POLL_LIMIT_MS = 10 * 60 * 1000;

// Коди, після яких локальний View застарів: підтягуємо свіжий з сервера
const RELOAD_CODES = new Set(['STATE_CONFLICT', 'STALE_DRAFT', 'REOPEN_CONFLICT', 'NOT_PENDING']);

// View за docs/api-v5.md §6 (GET /chat/:id)
const normalizeView = (data) => ({
  syllabus: data?.syllabus || null,
  state: data?.state || null,
  revision: data?.revision ?? null,
  sections: [...(data?.sections || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
  readiness: data?.readiness || null,
  programBlocks: data?.programBlocks || [],
  checks: data?.checks || [],
  suggestions: (data?.suggestions || []).map((s) => ({ ...s, id: s.id || s._id })),
  conversation: data?.conversation || null,
  messages: data?.messages || [],
});

const findSuggestion = (view, sid) => view?.suggestions?.find((s) => s.id === sid) || null;

const needsStart = (view) => view.syllabus?.status === 'in_progress'
  && !view.conversation
  && !view.syllabus?.needsRebuild
  && !view.syllabus?.legacy;

// Уся логіка робочого місця: View, опитування аналізу, мутації (кожна повертає View), документ, файл.
// client — services/api або мок-клієнт (mocks/chatV5.js) з тими самими методами.
export default function useWorkspace(syllabusId, { client = defaultClient, onNotFound, onLoaded } = {}) {
  const [view, setViewState] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [analysis, setAnalysis] = useState({ stage: null, error: null, timedOut: false });
  const [pollEpoch, setPollEpoch] = useState(0);
  const [pendingText, setPendingText] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const [diff, setDiff] = useState(false);
  const [doc, setDoc] = useState({ sections: null, loading: false, error: '' });
  const [policyLibrary, setPolicyLibrary] = useState({});

  const idRef = useRef(syllabusId);
  idRef.current = syllabusId;
  const viewRef = useRef(null);
  const mutationRef = useRef(false);
  const onNotFoundRef = useRef(onNotFound);
  onNotFoundRef.current = onNotFound;
  const onLoadedRef = useRef(onLoaded);
  onLoadedRef.current = onLoaded;

  const setView = useCallback((next) => {
    const value = typeof next === 'function' ? next(viewRef.current) : next;
    viewRef.current = value;
    setViewState(value);
  }, []);

  const status = view?.syllabus?.status;
  const revision = view?.revision;
  const ready = !!view && status === 'in_progress' && !view.syllabus?.needsRebuild;
  const documentReady = !!view?.state && !view.syllabus?.needsRebuild;

  const loadView = useCallback(async (id, { start = true } = {}) => {
    const { data } = await client.chat.get(id);
    let next = normalizeView(data);
    if (start && next.syllabus?.canMutate !== false && needsStart(next)) {
      const started = await client.chat.start(id);
      next = normalizeView(started.data);
    }
    return next;
  }, [client]);

  // Завантаження при зміні силабуса; автостарт розмови, коли аналіз завершено, а розмови ще немає.
  useEffect(() => {
    setView(null);
    setBusy(false);
    mutationRef.current = false;
    setError('');
    setAnalysis({ stage: null, error: null, timedOut: false });
    setPendingText(null);
    setDoc({ sections: null, loading: false, error: '' });
    if (!syllabusId) return undefined;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const next = await loadView(syllabusId);
        if (cancelled) return;
        setView(next);
        onLoadedRef.current?.(next.syllabus);
      } catch (err) {
        if (cancelled) return;
        if (err.response?.status === 404) {
          onNotFoundRef.current?.(syllabusId);
          return;
        }
        setError((await describeError(err, S.errLoad)).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [syllabusId, loadView, setView]);

  // Опитування етапу аналізу; після ANALYSIS_POLL_LIMIT_MS зупиняємось і пропонуємо повторити.
  useEffect(() => {
    if (!syllabusId || status !== 'analyzing') return undefined;
    let cancelled = false;
    let inFlight = false;
    let timer = null;
    const startedAt = Date.now();
    setAnalysis({ stage: null, error: null, timedOut: false });

    const tick = async () => {
      if (inFlight) return;
      if (Date.now() - startedAt > ANALYSIS_POLL_LIMIT_MS) {
        clearInterval(timer);
        setAnalysis((a) => ({ ...a, timedOut: true }));
        return;
      }
      inFlight = true;
      try {
        const { data } = await client.syllabus.getStatus(syllabusId);
        if (cancelled) return;
        if (data.status === 'analyzing') {
          setAnalysis((a) => ({ ...a, stage: data.stage || null }));
          return;
        }
        clearInterval(timer);
        if (data.status === 'error') {
          setAnalysis({ stage: data.stage || null, error: data.error || null, timedOut: false });
          setView((v) => (v ? { ...v, syllabus: { ...v.syllabus, status: 'error' } } : v));
          return;
        }
        const next = await loadView(syllabusId);
        if (cancelled) return;
        setView(next);
        onLoadedRef.current?.(next.syllabus);
      } catch (err) {
        if (cancelled) return;
        if (err.response?.status === 404) {
          clearInterval(timer);
          onNotFoundRef.current?.(syllabusId);
        }
        // Тимчасові мережеві збої ігноруємо — наступний тік повторить запит.
      } finally {
        inFlight = false;
      }
    };

    tick();
    timer = setInterval(tick, ANALYSIS_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [syllabusId, status, pollEpoch, client, loadView, setView]);

  // Якщо силабус уже в статусі error при відкритті — підтягуємо текст помилки.
  useEffect(() => {
    if (!syllabusId || status !== 'error') return undefined;
    let cancelled = false;
    client.syllabus.getStatus(syllabusId)
      .then(({ data }) => {
        if (!cancelled) setAnalysis((a) => ({ ...a, error: data.error || a.error }));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [syllabusId, status, client]);

  // Живий документ: перечитуємо на кожну нову ревізію стану і при перемиканні Diff.
  useEffect(() => {
    if (!syllabusId || !documentReady) return undefined;
    let cancelled = false;
    setDoc((d) => ({ ...d, loading: true, error: '' }));
    client.chat.document(syllabusId, { diff })
      .then(({ data }) => {
        if (!cancelled) setDoc({ sections: data?.sections || [], loading: false, error: '' });
      })
      .catch(async (err) => {
        if (cancelled) return;
        const info = await describeError(err, S.documentLoadError);
        setDoc((d) => ({ ...d, loading: false, error: info.message }));
      });
    return () => { cancelled = true; };
  }, [syllabusId, documentReady, revision, diff, client]);

  // Довідник політик для карток вибору (один раз на клієнт)
  useEffect(() => {
    if (!ready) return undefined;
    let cancelled = false;
    client.policies.syllabusLibrary()
      .then(({ data }) => {
        if (cancelled) return;
        const list = Array.isArray(data) ? data : data?.policies || [];
        setPolicyLibrary(Object.fromEntries(list.filter((p) => p.key).map((p) => [p.key, p])));
      })
      .catch(async (err) => {
        const info = await describeError(err, 'Could not load policy options.');
        if (!cancelled) setError(info.message);
      });
    return () => { cancelled = true; };
  }, [ready, client]);

  const reload = useCallback(async () => {
    const id = idRef.current;
    try {
      const next = await loadView(id, { start: false });
      if (idRef.current === id) setView(next);
    } catch {
      // Помилку першої дії вже показано; повторне завантаження — best-effort
    }
  }, [loadView, setView]);

  // Мутація: застосовує повернутий View. Повертає { ok, data } або { ok:false, error, code, status, details }.
  const mutate = useCallback(async (call) => {
    if (mutationRef.current) return { ok: false, error: 'Please wait for the current action to finish.' };
    const id = idRef.current;
    mutationRef.current = true;
    setBusy(true);
    try {
      const { data } = await call(id);
      if (idRef.current === id) setView(normalizeView(data));
      return { ok: true, data };
    } catch (err) {
      const info = await describeError(err);
      if (idRef.current === id && RELOAD_CODES.has(info.code)) reload();
      return { ok: false, error: info.message, code: info.code, status: info.status, details: info.data };
    } finally {
      if (idRef.current === id) { mutationRef.current = false; setBusy(false); }
    }
  }, [reload, setView]);

  const reportFailure = useCallback((result) => {
    if (!result.ok) setError(result.error);
    return result;
  }, []);

  const actions = useMemo(() => ({
    // Confirm: кнопка називає непідтверджені proposedValues, тож натискання підтверджує їх (POST values), потім accept.
    confirm: (sid, { optionId } = {}) => {
      const suggestion = findSuggestion(viewRef.current, sid);
      const unconfirmed = (suggestion?.draft?.proposedValues || []).filter((v) => !v.confirmed);
      const revisionAtClick = viewRef.current?.revision;
      return mutate(async (id) => {
        let expectedRevision = revisionAtClick;
        if (unconfirmed.length) {
          const response = await client.chat.setValues(id, sid,
            unconfirmed.map((v) => ({ id: v.id, value: v.value, confirmed: true })));
          if (idRef.current !== id) return response;
          const next = normalizeView(response.data);
          setView(next);
          expectedRevision = next.revision;
        }
        const body = {};
        if (expectedRevision != null) body.expectedRevision = expectedRevision;
        if (optionId) body.optionId = optionId;
        return client.chat.accept(id, sid, body);
      });
    },
    setValue: (sid, valueId, value) => mutate((id) => client.chat.setValues(id, sid, [{ id: valueId, value, confirmed: true }])),
    reject: (sid, body = {}) => mutate((id) => client.chat.reject(id, sid, body)),
    refine: (sid, body = {}) => mutate((id) => client.chat.refine(id, sid, body)),
    answer: (sid, answer) => mutate((id) => client.chat.answer(id, sid, answer)),
    reopen: (sid) => mutate((id) => client.chat.reopen(id, sid)),
    // B-5.1: відмова Approve (наприклад, SECTION_INCOMPLETE з прогалинами) показується в банері, а не мовчить
    approveSection: async (key) => reportFailure(await mutate((id) => client.chat.approveSection(id, key))),
    unapproveSection: async (key) => reportFailure(await mutate((id) => client.chat.unapproveSection(id, key))),
    setLanguage: async (language) => reportFailure(await mutate((id) => client.chat.setLanguage(id, language))),
    setProgramBlock: async (programBlock) => reportFailure(await mutate((id) => client.chat.setProgramBlock(id, programBlock))),
    // { ok, data: { approved, skipped, ...View } }. keys — розділи з картки (без них — усі); ревізія — на момент натискання.
    approveAll: (keys) => {
      const expectedRevision = viewRef.current?.revision;
      const body = {};
      if (Array.isArray(keys) && keys.length) body.sections = keys;
      if (expectedRevision != null) body.expectedRevision = expectedRevision;
      return mutate((id) => client.chat.approveAll(id, body));
    },
    choosePolicy: (key, optionKey) => mutate((id) => client.chat.choosePolicy(id, key, { optionKey })),
    keepPolicyText: (key) => mutate((id) => client.chat.choosePolicy(id, key, { keepText: true })),
    writeOwnPolicy: (key) => mutate((id) => client.chat.choosePolicy(id, key, { writeOwn: true })),
    skip: (slotKey) => mutate((id) => client.chat.skip(id, slotKey)),
  }), [mutate, client, setView, reportFailure]);

  // Вільне повідомлення: показуємо його одразу, відповідь (хід оркестратора) приходить у View.
  // Stop обриває очікування відповіді на клієнті. Сервер міг уже обробити повідомлення,
  // тому після обриву перечитуємо View: якщо повідомлення там є — воно вважається надісланим.
  const abortRef = useRef(null);
  const sendMessage = useCallback(async (text) => {
    const id = idRef.current;
    const controller = new AbortController();
    abortRef.current = controller;
    setError('');
    setPendingText(text);
    const result = await mutate((id) => client.chat.sendMessage(id, text, { signal: controller.signal }));
    abortRef.current = null;
    if (idRef.current !== id) return result.ok;
    if (controller.signal.aborted) {
      await reload();
      setPendingText(null);
      const sent = (viewRef.current?.messages || []).slice(-3)
        .some((m) => m.role === 'user' && m.content === text);
      return sent;
    }
    setPendingText(null);
    return reportFailure(result).ok;
  }, [mutate, reportFailure, reload, client]);

  const stopMessage = useCallback(() => abortRef.current?.abort(), []);

  // Повторний аналіз або перебудова v4 → v5 (needsRebuild)
  const reanalyze = useCallback(async () => {
    const id = idRef.current;
    setBusy(true);
    setError('');
    try {
      await client.syllabus.reanalyze(id);
      if (idRef.current !== id) return;
      setView((v) => (v ? {
        ...v,
        conversation: null,
        messages: [],
        suggestions: [],
        readiness: null,
        syllabus: { ...v.syllabus, canMutate: true, status: 'analyzing', needsRebuild: false },
      } : v));
      setAnalysis({ stage: null, error: null, timedOut: false });
      setPollEpoch((n) => n + 1);
    } catch (err) {
      setError((await describeError(err, S.errRebuild)).message);
    } finally {
      setBusy(false);
    }
  }, [client, setView]);

  const downloadDocx = useCallback(async () => {
    setDownloading(true);
    setError('');
    try {
      const response = await client.chat.downloadDocx(idRef.current);
      const filename = filenameFromDisposition(response.headers?.['content-disposition'])
        || docxFallbackName(viewRef.current?.syllabus?.title);
      saveBlob(response.data, filename);
    } catch (err) {
      setError((await describeError(err, S.errDownload)).message);
    } finally {
      setDownloading(false);
    }
  }, [client]);

  const syllabus = view?.syllabus || null;
  const needsRebuild = !!syllabus?.needsRebuild;
  const legacy = !!syllabus?.legacy;
  // canMutate: власник (адмін — лише читання); v4 до перебудови і legacy теж лише читаються
  const readOnly = syllabus?.canMutate === false || legacy || needsRebuild;

  return {
    syllabus,
    state: view?.state || null,
    revision: view?.revision ?? null,
    sections: view?.sections || [],
    readiness: view?.readiness || null,
    programBlocks: view?.programBlocks || [],
    checks: view?.checks || [],
    suggestions: view?.suggestions || [],
    conversation: view?.conversation || null,
    messages: view?.messages || [],
    policyLibrary,
    document: doc,
    diff,
    setDiff,
    loaded: !!view,
    loading,
    error,
    setError,
    clearError: () => setError(''),
    busy,
    analysis,
    pendingText,
    downloading,
    needsRebuild,
    legacy,
    readOnly,
    actions,
    sendMessage,
    stopMessage,
    reanalyze,
    downloadDocx,
  };
}
