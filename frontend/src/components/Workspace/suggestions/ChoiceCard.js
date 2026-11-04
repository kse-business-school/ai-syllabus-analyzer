import React, { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Radio from '@mui/material/Radio';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Check from '@mui/icons-material/Check';
import SuggestionFrame from './SuggestionFrame';
import valueText from './valueText';
import { S } from '../../../strings';

// Текст варіанта: власне value або (для політик) текст варіанта довідника за optionKey
const optionBody = (option, library) => {
  if (option.after != null) return valueText(option.after);
  if (option.value !== undefined && option.value !== null) return valueText(option.value);
  if (option.optionKey && library) return library.options?.find((o) => o.key === option.optionKey)?.text || '';
  return '';
};

// kind = 'choice': кілька варіантів значення слота (варіант політики, «Keep my text», …). Дефолту немає.
const ChoiceCard = ({ suggestion, actions, policyLibrary = {}, ...frameProps }) => {
  const options = suggestion.options || [];
  const pending = suggestion.status === 'pending';
  const [selected, setSelected] = useState(suggestion.selectedOptionId || null);
  const policyKey = suggestion.target?.path?.match(/^policies\{(.+)\}$/)?.[1];
  const library = policyKey ? policyLibrary[policyKey] : null;

  useEffect(() => {
    setSelected(suggestion.selectedOptionId || null);
  }, [suggestion.selectedOptionId, suggestion.id]);

  // Для вирішеної пропозиції показуємо лише обраний варіант
  const visible = pending ? options : options.filter((o) => o.id === suggestion.selectedOptionId);
  const chosen = options.find((o) => o.id === selected);

  return (
    <SuggestionFrame
      suggestion={suggestion}
      actions={actions}
      primary={{
        label: chosen ? `Confirm · ${chosen.label}` : 'Confirm',
        icon: <Check />,
        disabled: !selected,
        onClick: () => actions.confirm(suggestion.id, { optionId: selected }),
      }}
      {...frameProps}
    >
      <Stack spacing={1}>
        {visible.map((option) => {
          const isSelected = selected === option.id;
          const body = optionBody(option, library);
          const photos = suggestion.target?.section === 'instructor'
            ? (Array.isArray(option.value) ? option.value : []).filter((instructor) => /^data:image\/jpeg;base64,/.test(instructor?.photo || ''))
            : [];
          return (
            <Box
              key={option.id}
              onClick={() => pending && !frameProps.readOnly && !frameProps.busy && setSelected(option.id)}
              sx={{
                p: 1.25,
                border: '1px solid',
                borderColor: isSelected ? 'primary.main' : 'divider',
                borderRadius: 0,
                cursor: pending ? 'pointer' : 'default',
                bgcolor: isSelected && pending ? 'action.selected' : 'transparent',
              }}
            >
              <Stack direction="row" alignItems="flex-start" spacing={0.5}>
                {pending && (
                  <Radio
                    size="small"
                    checked={isSelected}
                    disabled={frameProps.readOnly || frameProps.busy}
                    onChange={() => setSelected(option.id)}
                    inputProps={{ 'aria-label': option.label }}
                    sx={{ mt: -0.5, ml: -0.75 }}
                  />
                )}
                <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                  <Typography variant="subtitle2">{option.label}</Typography>
                  {photos.map((instructor, index) => (
                    <Box key={instructor.id || index} component="img" src={instructor.photo}
                      alt={instructor.name ? `Photo of ${instructor.name}` : 'Instructor photo'}
                      sx={{ width: 64, height: 64, objectFit: 'cover', display: 'block', my: 1 }} />
                  ))}
                  {body && (
                    <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                      {body}
                    </Typography>
                  )}
                </Box>
              </Stack>
            </Box>
          );
        })}
        {!visible.length && <Typography variant="body2" color="text.secondary">{S.noOptions}</Typography>}
      </Stack>
    </SuggestionFrame>
  );
};

export default ChoiceCard;
