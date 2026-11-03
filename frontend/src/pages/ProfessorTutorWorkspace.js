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
  const [structureDrawerOpen, setStructureDrawerOpen] = useState(false);
  const [focusedKey, setFocusedKey] = useState(null);
  const [highlightedId, setHighlightedId] = useState(null);

  const { openTabs, closeTab, ensureTab, dropMissing } = useWorkspaceTabs(user, mockId ? null : syllabusId);
  const ws = useWorkspace(syllabusId, {
    client,
    onNotFound: dropMissing,
    onLoaded: (syl) => {
      if (syl && !mockId) ensureTab(syl.id || syllabusId, syl.title);
    },
  });

  const threadRef = useRef(null);
  const highlightTimer = useRef(null);
  const { messages, suggestions, syllabus } = ws;

  useEffect(() => () => clearTimeout(highlightTimer.current), []);
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
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

  const selectSection = (key) => {
    setFocusedKey(key);
    const sg = suggestions.find((s) => s.section === key && s.status === 'pending');
    if (sg) scrollToSuggestion(sg.id);
    if (!isTabletOrUp) setMobileTab('document');
  };

  const handleDiscussInChat = (sectionKey, sectionTitle) => {
    setFocusedKey(sectionKey);
    if (!isTabletOrUp) setMobileTab('chat');
    ws.sendMessage(`Let's discuss and refine section "${sectionTitle}". What improvements do you recommend?`);
  };

  const handleApproveFromDoc = async (sectionKey) => {
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
        {openTabs.length > 0 && tabs}
        <Box sx={{ overflow: 'auto', flex: 1 }}>
          <EmptyState
            onUploaded={(id) => {
              ensureTab(id, '');
              navigate(`/workspace/${id}`);
            }}
          />
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
      document={ws.loaded && !ws.state ? { sections: [], error: ws.needsRebuild ? S.rebuildBanner : '' } : ws.document}
      templateSections={ws.sections}
      diff={ws.diff}
      onToggleDiff={ws.setDiff}
      onDownload={ws.downloadDocx}
      downloading={ws.downloading}
      canDownload={Boolean(ws.state)}
      focusedKey={focusedKey}
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
        <Alert severity="error" onClose={ws.clearError} sx={{ borderRadius: 0, py: 0.5 }}>
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
            onChange={(e, val) => val && setMobileTab(val)}
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
            <ToggleButton value="document">Document</ToggleButton>
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
            <Box ref={threadRef} sx={{ flex: 1, overflowY: 'auto', p: { xs: 1.5, md: 2 } }}>
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
                    <Alert severity="info" sx={{ borderRadius: 1.5 }}>
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
              disabled={!ready || ws.readOnly || isReadOnlyAdmin || ws.busy}
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
