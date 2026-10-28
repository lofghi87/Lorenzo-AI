(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LorenzoChatFeatures = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function normalize(value) {
    return String(value || '').normalize('NFKC').toLocaleLowerCase();
  }

  function matchesChat(chat, query) {
    const term = normalize(query).trim();
    if (!term) return true;
    const messages = Array.isArray(chat?.messages) ? chat.messages : [];
    const content = messages.map(message => [
      message?.content || '',
      ...(Array.isArray(message?.attachmentNames) ? message.attachmentNames : [])
    ].join(' ')).join(' ');
    return normalize((chat?.title || '') + ' ' + content).includes(term);
  }

  function toMarkdown(chat) {
    const title = String(chat?.title || 'Nuova conversazione').trim() || 'Nuova conversazione';
    const messages = Array.isArray(chat?.messages) ? chat.messages : [];
    const sections = messages.map(message => {
      const role = message?.role === 'user' ? 'Tu' : 'Lorenzo AI';
      const parts = [String(message?.content || '').trim()];
      if (Array.isArray(message?.attachmentNames) && message.attachmentNames.length) {
        parts.push('Allegati: ' + message.attachmentNames
          .filter(name => typeof name === 'string' && name.trim())
          .join(', '));
      }
      if (message?.imagePath) parts.push('[Immagine generata: disponibile nella conversazione originale]');
      return '## ' + role + '\n\n' + (parts.filter(Boolean).join('\n\n') || '_Nessun testo_');
    });
    return '# ' + title + '\n\n' + (sections.length ? sections.join('\n\n---\n\n') : '_Conversazione vuota_') + '\n';
  }

  function safeFilename(value) {
    const result = String(value || 'conversazione')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9_-]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60);
    return result || 'conversazione';
  }

  function appendTranscript(existing, transcript, maxLength) {
    const current = String(existing || '');
    const addition = String(transcript || '').trim();
    if (!addition) return current;
    const separator = current && !/\s$/.test(current) ? ' ' : '';
    const remaining = Math.max(0, (Number(maxLength) || 12000) - current.length - separator.length);
    if (!remaining) return current;
    return current + separator + addition.slice(0, remaining);
  }

  return Object.freeze({ matchesChat, toMarkdown, safeFilename, appendTranscript });
});
