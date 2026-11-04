import React from 'react';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Typography from '@mui/material/Typography';
import TextMessage from './TextMessage';
import QuestionMessage from './QuestionMessage';
import DraftCard from '../suggestions/DraftCard';
import ChoiceCard from '../suggestions/ChoiceCard';
import QuestionCard from '../suggestions/QuestionCard';
import PolicyChoiceCard from '../suggestions/PolicyChoiceCard';
import ApproveAllCard from '../suggestions/ApproveAllCard';
import { S } from '../../../strings';

// Одна картка на kind пропозиції; повідомлення містить лише id пропозиції.
const SUGGESTION_CARDS = {
  edit: DraftCard,
  choice: ChoiceCard,
  question: QuestionCard,
};

const STATUS_LABELS = { pending: 'Open', accepted: S.confirmed, rejected: S.cancelled };

// Дані повідомлення v5 лежать у payload (Message.payload); на випадок пласкої форми — саме повідомлення
export const payloadOf = (message) => message.payload || message;

// Якщо пропозиція вже показана нижче в стрічці (після Reword чи Undo), старе місце — компактне посилання.
const SuggestionReference = ({ suggestion, onSelect }) => (
  <Box
    onClick={() => onSelect?.(suggestion.id)}
    sx={{ display: 'flex', gap: 1, alignItems: 'center', mb: 1.5, cursor: 'pointer', color: 'text.secondary' }}
  >
    <Chip size="small" variant="outlined" label={STATUS_LABELS[suggestion.status] || suggestion.status} />
    <Typography variant="body2" sx={{ textDecoration: 'underline' }}>{suggestion.title}</Typography>
  </Box>
);

// Картка, що чекає черги: одна активна картка за раз, решта — рядок «Up next».
const QueuedRow = ({ title }) => (
  <Typography variant="body2" color="text.secondary" noWrap sx={{ py: 0.75, mb: 0.5 }}>
    Up next · {title}
  </Typography>
);

const MessageItem = ({
  message,
  suggestion,
  isLatestForSuggestion = true,
  isLast = false,
  cardState = 'active', // 'active' | 'queued'
  ctx,
}) => {
  const { actions, busy, readOnly, highlightedId, sectionsByKey, policyLibrary, statePolicies, readiness, sections, documentSections, onSelectSuggestion } = ctx;
  const payload = payloadOf(message);
  switch (message.kind) {
    case 'text':
      return <TextMessage message={message} />;
    case 'question':
      return <QuestionMessage payload={payload} active={isLast} busy={busy} readOnly={readOnly} onSkip={actions.skip} onQuickAnswer={actions.send} />;
    case 'approve-all':
      if (cardState === 'queued') return <QueuedRow title={S.noChangesTitle((payload.sections || []).length)} />;
      return (
        <ApproveAllCard
          sectionKeys={payload.sections || []}
          sections={sections}
          readiness={readiness}
          documentSections={documentSections}
          actions={actions}
          busy={busy}
          readOnly={readOnly}
        />
      );
    case 'policy-choice': {
      const key = payload.policyKey;
      if (cardState === 'queued') return <QueuedRow title={policyLibrary[key]?.title || payload.title || key} />;
      return (
        <PolicyChoiceCard
          policyKey={key}
          policy={policyLibrary[key] || (payload.options ? { key, title: payload.title, options: payload.options } : null)}
          statePolicy={statePolicies.find((p) => p.key === key)}
          actions={actions}
          busy={busy}
          readOnly={readOnly}
          highlighted={highlightedId === `policy:${key}`}
        />
      );
    }
    case 'suggestion': {
      if (!suggestion) return null;
      if (!isLatestForSuggestion) {
        return <SuggestionReference suggestion={suggestion} onSelect={onSelectSuggestion} />;
      }
      const Card = SUGGESTION_CARDS[suggestion.kind];
      if (!Card) return null;
      if (cardState === 'queued') return <QueuedRow title={suggestion.title} />;
      const sec = sectionsByKey.get(suggestion.section || suggestion.target?.section);
      return (
        <Card
          suggestion={suggestion}
          sectionTitle={sec ? (sec.docNumber ? `${sec.docNumber} · ${sec.title}` : sec.title) : null}
          actions={actions}
          policyLibrary={policyLibrary}
          busy={busy}
          readOnly={readOnly}
          highlighted={highlightedId === suggestion.id}
        />
      );
    }
    default:
      return null;
  }
};

export default MessageItem;
