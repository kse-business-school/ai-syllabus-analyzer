import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Drawer from '@mui/material/Drawer';
import Typography from '@mui/material/Typography';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import ToggleButton from '@mui/material/ToggleButton';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useAuth } from '../contexts/AuthContext';
import { useWorkspaceChrome } from '../contexts/WorkspaceChromeContext';
import { computeGroupedReadiness } from '../utils/sectionGroups';
import { getPendingCardIds, getActiveCardId } from '../utils/activeCard';
import useWorkspace from '../hooks/useWorkspace';
import useWorkspaceTabs from '../hooks/useWorkspaceTabs';
import EmptyState from '../components/Workspace/EmptyState';
import ChatInput from '../components/Workspace/ChatInput';
import MessageItem, { payloadOf } from '../components/Workspace/messages/MessageItem';
import PendingReply from '../components/Workspace/messages/PendingReply';
import Bubble from '../components/Workspace/messages/Bubble';
import WorkspaceTabs from '../components/Workspace/WorkspaceTabs';
import SyllabusStructurePanel from '../components/Workspace/SyllabusStructurePanel';
import LiveDocumentPanel from '../components/Workspace/LiveDocumentPanel';
import WorkspaceBanners from '../components/Workspace/WorkspaceBanners';
import AnalysisProgress from '../components/Workspace/AnalysisProgress';
import { USE_MOCKS } from '../services/workspaceClient';
import { S } from '../strings';

const ProfessorTutorWorkspace = ({ client, mockId }) => {
  const { syllabusId: routeId } = useParams();
  const syllabusId = mockId || routeId;
  const navigate = useNavigate();
  const { user } = useAuth();

  // Breakpoints per spec:
  // >= 1300px: All 3 panels open
  // 1024px - 1299px: Left panel collapsable / drawer, right min 512px
  // < 1024px: Single panel with top segmented switcher
  const isWideDesktop = useMediaQuery('(min-width:1300px)');
  const isTabletOrUp = useMediaQuery('(min-width:1024px)');

  const [mobileTab, setMobileTab] = useState('chat'); // 'structure' | 'chat' | 'document'
  const [docUpdatedBadge, setDocUpdatedBadge] = useState(false);
  const [structureDrawerOpen, setStructureDrawerOpen] = useState(false);
  const [focusedKey, setFocusedKey] = useState(null);
  const [highlightedId, setHighlightedId] = useState(null);
  const [lastChangedKey, setLastChangedKey] = useState(null);

  const { openTabs, closeTab, ensureTab, dropMissing } = useWorkspaceTabs(user, mockId ? null : syllabusId);
  const ws = useWorkspace(syllabusId, {
    client,
    onNotFound: dropMissing,
    onLoaded: (syl) => {
      if (syl && !mockId) ensureTab(syl.id || syllabusId, syl.title);
    },
  });

  const { messages, suggestions, syllabus } = ws;
  const threadRef = useRef(null);
  const stickToBottomRef = useRef(true);
  const highlightTimer = useRef(null);
  const prevRevRef = useRef(ws.state?.revision);

  // Відстеження оновлення документу для бейджа на вкладці Document (< 1024px)
  useEffect(() => {
    if (prevRevRef.current !== undefined && ws.state?.revision !== undefined && prevRevRef.current !== ws.state?.revision) {
      if (!isTabletOrUp && mobileTab !== 'document') {
        setDocUpdatedBadge(true);
      }
    }
    prevRevRef.current = ws.state?.revision;
  }, [ws.state?.revision, isTabletOrUp, mobileTab]);

  const handleMobileTabChange = (val) => {
    if (!val) return;
    if (val === 'document') setDocUpdatedBadge(false);
    setMobileTab(val);
  };

  const scrollToSuggestion = useCallback((id) => {
    const target = document.getElementById(id.startsWith('policy:') ? `policy-${id.slice(7)}` : `suggestion-${id}`);
    const el = threadRef.current;
    if (target && el) {
      el.scrollTo({
        top: target.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop - 24,
        behavior: 'smooth',
      });
    }
    setHighlightedId(id);
    clearTimeout(highlightTimer.current);
    highlightTimer.current = setTimeout(() => setHighlightedId(null), 1600);
  }, []);

  const selectSection = useCallback((key) => {
    setFocusedKey(key);
    setLastChangedKey(key);
    const sg = ws.suggestions.find((s) => s.section === key && s.status === 'pending');
    if (sg) scrollToSuggestion(sg.id);
    if (!isTabletOrUp) setMobileTab('document');
  }, [ws.suggestions, isTabletOrUp, scrollToSuggestion]);

  // Фокус на першу відкриту перевірку при кліку в шапці на «N checks open»
  const handleFocusCheck = useCallback(() => {
    const firstCheck = (ws.checks || []).find((c) => c.passed === false);
    if (!firstCheck) return;
    const targetKey = firstCheck.section || firstCheck.target?.section;
    if (targetKey) {
      selectSection(targetKey);
    }
  }, [ws.checks, selectSection]);

  // Readiness, Download .docx і відкриті перевірки — у верхній панелі
  const { setChrome } = useWorkspaceChrome();
  const grouped = useMemo(() => computeGroupedReadiness(ws.readiness, ws.state), [ws.readiness, ws.state]);
  const openChecks = (ws.checks || []).filter((c) => c.passed === false).length;
  const hasDocument = Boolean(ws.state);
  const { downloadDocx, downloading } = ws;

  useEffect(() => {
    if (!syllabusId || !hasDocument) {
      setChrome(null);
      return undefined;
    }
    setChrome({
      readinessValue: grouped.isEmpty ? '—' : `${grouped.percent}%`,
      readinessLabel: grouped.isEmpty ? 'no document yet' : grouped.label,
      approvedLabel: grouped.isEmpty ? 'No document yet' : `${grouped.approvedCount} of ${grouped.totalCount} approved`,
      openChecks,
      onFocusCheck: handleFocusCheck,
      canDownload: true,
      downloading,
      onDownload: downloadDocx,
    });
    return undefined;
  }, [syllabusId, hasDocument, grouped, openChecks, handleFocusCheck, downloading, downloadDocx, setChrome]);
  useEffect(() => () => setChrome(null), [setChrome]);

  useEffect(() => () => clearTimeout(highlightTimer.current), []);

  const handleThreadScroll = (e) => {
    const el = e.target;
    // Користувач вважається внизу, якщо відстань до низу < 120px
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

  useEffect(() => {
    const el = threadRef.current;
    if (el && stickToBottomRef.current) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    }
  }, [messages.length, ws.pendingText]);

  useEffect(() => {
    setFocusedKey(null);
  }, [syllabusId]);

  const suggestionById = useMemo(() => new Map(suggestions.map((s) => [s.id, s])), [suggestions]);
  const sectionsByKey = useMemo(() => new Map(ws.sections.map((s) => [s.key, s])), [ws.sections]);
  const activeQuestion = [...messages]
    .reverse()
    .find((m) => m.kind === 'question' && payloadOf(m).slotKey === ws.conversation?.currentSlotKey)?._id;
  const latest = useMemo(() => {
    const map = new Map();
    messages.forEach((m) => {
      if (m.kind === 'suggestion') map.set(m.relatedSuggestionId, m._id);
    });
    return map;
  }, [messages]);

  // Одна активна картка за чистою функцією getPendingCardIds / getActiveCardId
  const pendingCardIds = useMemo(
    () =>
      getPendingCardIds({
        messages,
        suggestions,
        suggestionById,
        latest,
        state: ws.state,
        readiness: ws.readiness,
      }),
    [messages, suggestions, suggestionById, latest, ws.state, ws.readiness]
  );
  const activeCardId = useMemo(
    () =>
      getActiveCardId({
        messages,
        suggestions,
        suggestionById,
        latest,
        state: ws.state,
        readiness: ws.readiness,
      }),
    [messages, suggestions, suggestionById, latest, ws.state, ws.readiness]
  );

  const focusedSection = ws.sections.find((sec) => sec.key === focusedKey);
  const chatPlaceholder = activeQuestion
    ? 'Type your answer, or ask for something else…'
    : focusedSection
      ? `Ask about ${focusedSection.title}, or tell me what to change…`
      : undefined;

  const handleDiscussInChat = (sectionKey, sectionTitle) => {
    setFocusedKey(sectionKey);
    setLastChangedKey(sectionKey);
    if (!isTabletOrUp) setMobileTab('chat');
    ws.sendMessage(`Let's discuss and refine section "${sectionTitle}". What improvements do you recommend?`);
  };

  const handleApproveFromDoc = async (sectionKey) => {
    setLastChangedKey(sectionKey);
    await ws.actions.approveSection(sectionKey);
  };

  const tabs = !mockId && (
    <WorkspaceTabs
      tabs={openTabs}
      activeId={syllabusId}
      onSelect={(id) => navigate(`/workspace/${id}`)}
      onClose={closeTab}
      onNew={() => navigate('/workspace')}
    />
  );

  if (!syllabusId) {
    return (
      <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {tabs}
        <Box sx={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {isWideDesktop && <Box sx={{ width: 248, flexShrink: 0 }}><SyllabusStructurePanel /></Box>}
        <Box sx={{ overflow: 'auto', flex: 1, minWidth: 0, bgcolor: 'background.paper' }}>
          <EmptyState
            onUploaded={(id) => {
              ensureTab(id, '');
              navigate(`/workspace/${id}`);
            }}
          />
        </Box>
        {isTabletOrUp && <Box sx={{ flex: '0 0 42%', minWidth: 420, borderLeft: '1px solid', borderColor: 'divider', bgcolor: 'background.paper', display: 'grid', placeItems: 'center', p: 5 }}><Typography sx={{ color: 'text.muted', fontSize: 13, textAlign: 'center' }}>Your syllabus appears here as we build it.<br />Every confirmed answer lands on this side.</Typography></Box>}
        </Box>
      </Box>
    );
  }

  const analyzing = syllabus?.status === 'analyzing';
  const failed = syllabus?.status === 'error';
  const isReadOnlyAdmin = Boolean(user?.role === 'admin' && syllabus?.userId && syllabus.userId !== user?.id);
  const ready = ws.loaded && !analyzing && !failed && !ws.needsRebuild;

  const ctx = {
    actions: ws.actions,
    busy: ws.busy,
    readOnly: ws.readOnly || isReadOnlyAdmin || !ready,
    highlightedId,
    sectionsByKey,
    sections: ws.sections,
    readiness: ws.readiness,
    policyLibrary: ws.policyLibrary,
    statePolicies: ws.state?.policies || [],
    documentSections: ws.document.sections || [],
    onSelectSuggestion: scrollToSuggestion,
  };

  const structureComponent = (
    <SyllabusStructurePanel
      sections={ws.sections}
      readiness={ws.readiness}
      state={ws.state}
      focusedKey={focusedKey}
      onSelect={selectSection}
      actions={ws.actions}
      busy={ws.busy}
      readOnly={ws.readOnly || isReadOnlyAdmin || !ready}
    />
  );

  const documentComponent = (
    <LiveDocumentPanel
      instructors={ws.state?.instructors}
      document={ws.loaded && !ws.state ? { sections: [], error: ws.needsRebuild ? S.rebuildBanner : '' } : ws.document}
      templateSections={ws.sections}
      diff={ws.diff}
      onToggleDiff={ws.setDiff}
      focusedKey={focusedKey}
      highlightedSectionKey={lastChangedKey}
      checks={ws.checks}
      readiness={ws.readiness}
      onApproveSection={handleApproveFromDoc}
      onDiscussSection={handleDiscussInChat}
      readOnly={ws.readOnly || isReadOnlyAdmin || !ready}
    />
  );

  return (
    <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', bgcolor: 'background.default' }}>
      {tabs}
      {(USE_MOCKS || mockId) && <Alert severity="info" sx={{ borderRadius: 0, py: 0.5 }}>{S.mocksBanner}</Alert>}
      {ws.error && (
        <Alert severity="error" role="alert" aria-live="assertive" onClose={ws.clearError} sx={{ borderRadius: 0, py: 0.5 }}>
          {ws.error}
        </Alert>
      )}

      <WorkspaceBanners
        syllabus={syllabus}
        isReadOnlyAdmin={isReadOnlyAdmin}
        busy={ws.busy}
        onRebuild={ws.reanalyze}
        onUploadAgain={() => navigate('/workspace')}
      />

      {/* Перемикач для екранів < 1024px */}
      {!isTabletOrUp && (
        <Box
          sx={{
            p: 1,
            bgcolor: 'background.paper',
            borderBottom: '1px solid',
            borderColor: 'divider',
            display: 'flex',
            justifyContent: 'center',
          }}
        >
          <ToggleButtonGroup
            value={mobileTab}
            exclusive
            size="small"
            onChange={(e, val) => handleMobileTabChange(val)}
            sx={{
              height: 30,
              bgcolor: 'background.default',
              '& .MuiToggleButton-root': {
                fontSize: '0.75rem',
                py: 0.25,
                px: 2,
                fontWeight: 500,
                textTransform: 'none',
                '&.Mui-selected': {
                  bgcolor: 'background.paper',
                  color: 'primary.main',
                  fontWeight: 600,
                },
              },
            }}
          >
            <ToggleButton value="structure">Structure</ToggleButton>
            <ToggleButton value="chat">Chat</ToggleButton>
            <ToggleButton value="document">
              Document
              {docUpdatedBadge && (
                <Box
                  component="span"
                  sx={{
                    width: 6,
                    height: 6,
                    ml: 0.75,
                    borderRadius: '50%',
                    bgcolor: 'primary.main',
                    display: 'inline-block',
                  }}
                />
              )}
            </ToggleButton>
          </ToggleButtonGroup>
        </Box>
      )}

      {/* Компактний ноутбук (1024px - 1299px): смуга виклику бічної структури */}
      {isTabletOrUp && !isWideDesktop && (
        <Box
          sx={{
            py: 0.5,
            px: 2,
            bgcolor: 'background.paper',
            borderBottom: '1px solid',
            borderColor: 'divider',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <Button
            size="small"
            variant="outlined"
            onClick={() => setStructureDrawerOpen(true)}
            sx={{ fontSize: '0.75rem', height: 26, py: 0.25, px: 1.25 }}
          >
            Sections (8 groups)
          </Button>
        </Box>
      )}

      {/* Основний контейнер трьох панелей */}
      <Box sx={{ flex: 1, display: 'flex', minHeight: 0, minWidth: 0, overflow: 'hidden' }}>
        {/* Ліва панель: фіксовано 248px на >= 1300px */}
        {isWideDesktop && (
          <Box sx={{ width: 248, minWidth: 248, maxWidth: 248, height: '100%' }}>
            {structureComponent}
          </Box>
        )}

        {/* Центральна панель: Чат і чернетки */}
        {(!isTabletOrUp ? mobileTab === 'chat' : true) && (
          <Box
            sx={{
              flex: '1 1 420px',
              minWidth: { xs: '100%', md: 380 },
              display: 'flex',
              flexDirection: 'column',
              height: '100%',
              bgcolor: 'background.canvas',
            }}
          >
            <Box
              ref={threadRef}
              onScroll={handleThreadScroll}
              role="region"
              aria-label="Consultation messages"
              aria-live="polite"
              sx={{ flex: 1, overflowY: 'auto', p: { xs: 2, md: 3 } }}
            >
              {ws.loading && !ws.loaded ? (
                <Box sx={{ textAlign: 'center', mt: 8 }}>
                  <CircularProgress size={32} />
                  <Typography variant="body2" sx={{ mt: 1.5, color: 'text.secondary' }}>
                    {S.loadingConversation}
                  </Typography>
                </Box>
              ) : analyzing || failed ? (
                <AnalysisProgress
                  stage={ws.analysis.stage}
                  error={ws.analysis.error}
                  failed={failed}
                  timedOut={ws.analysis.timedOut}
                  busy={ws.busy}
                  onRetry={ws.reanalyze}
                />
              ) : ws.loaded && (
                <>
                  {!messages.length && (
                    <Alert severity="info" sx={{ borderRadius: 0 }}>
                      {S.noMessages}
                    </Alert>
                  )}
                  {messages.map((m, i) => (
                    <MessageItem
                      key={m._id}
                      message={m}
                      suggestion={suggestionById.get(m.relatedSuggestionId)}
                      isLatestForSuggestion={latest.get(m.relatedSuggestionId) === m._id}
                      isLast={activeQuestion ? m._id === activeQuestion : i === messages.length - 1}
                      cardState={pendingCardIds.includes(m._id) && m._id !== activeCardId ? 'queued' : 'active'}
                      ctx={ctx}
                    />
                  ))}
                  {ws.pendingText && (
                    <>
                      <Bubble role="user">
                        <Typography sx={{ whiteSpace: 'pre-wrap', fontSize: '0.875rem' }}>
                          {ws.pendingText}
                        </Typography>
                      </Bubble>
                      <PendingReply />
                    </>
                  )}
                </>
              )}
            </Box>

            <ChatInput
              key={syllabusId}
              onSend={ws.sendMessage}
              onStop={ws.stopMessage}
              placeholder={chatPlaceholder}
              disabled={!ready || ws.busy}
              readOnly={ws.readOnly || isReadOnlyAdmin}
            />
          </Box>
        )}

        {/* Права панель: Live Document */}
        {(!isTabletOrUp ? mobileTab === 'document' : true) && (
          <Box
            sx={{
              flex: '1 1 520px',
              minWidth: { xs: '100%', md: 512 },
              height: '100%',
            }}
          >
            {documentComponent}
          </Box>
        )}

        {/* Мобільна вкладка структури (< 1024px) */}
        {!isTabletOrUp && mobileTab === 'structure' && (
          <Box sx={{ width: '100%', height: '100%' }}>{structureComponent}</Box>
        )}
      </Box>

      {/* Drawer для структури на ноутбуках (1024px - 1299px) */}
      <Drawer
        anchor="left"
        open={structureDrawerOpen}
        onClose={() => setStructureDrawerOpen(false)}
        PaperProps={{ sx: { width: 300, bgcolor: 'background.paper' } }}
      >
        <Box sx={{ p: 1, display: 'flex', justifyContent: 'flex-end', borderBottom: '1px solid', borderColor: 'divider' }}>
          <Button size="small" onClick={() => setStructureDrawerOpen(false)}>
            Close
          </Button>
        </Box>
        {structureComponent}
      </Drawer>
    </Box>
  );
};

export default ProfessorTutorWorkspace;
