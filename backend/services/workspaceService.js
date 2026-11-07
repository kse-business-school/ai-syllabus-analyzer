// Фасад сервісів чату (services/chat/*) і виходу — для маршрутів і тестів.

const view = require('./chat/view');
const flow = require('./chat/flow');
const decisions = require('./chat/decisions');
const sections = require('./chat/sections');
const policies = require('./chat/policies');
const { freeChatMessage } = require('./chat/freeChat');
const { getOutputFile } = require('./outputs');

module.exports = {
  getConversationView: view.getConversationView,
  documentView: view.documentView,
  getOrCreateConversation: flow.getOrCreateConversation,
  startConversation: flow.startConversation,
  skipSlot: flow.skipSlot,
  postNextStep: flow.postNextStep,
  acceptSuggestion: decisions.acceptSuggestion,
  updateValues: decisions.updateValues,
  rejectSuggestion: decisions.rejectSuggestion,
  reopenSuggestion: decisions.reopenSuggestion,
  refineSuggestion: decisions.refineSuggestion,
  answerSuggestion: decisions.answerSuggestion,
  approveSection: sections.approveSection,
  unapproveSection: sections.unapproveSection,
  setDocumentLanguage: sections.setDocumentLanguage,
  setProgramBlock: sections.setProgramBlock,
  approveAllSections: sections.approveAll,
  choosePolicy: policies.choosePolicy,
  freeChatMessage,
  getOutputFile,
};
