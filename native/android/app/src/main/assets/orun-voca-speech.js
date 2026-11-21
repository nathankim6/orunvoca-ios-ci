(() => {
  const port = window.__orunVocaSpeechBridge;
  if (!port || typeof port.postMessage !== 'function' || window.OrunVocaSpeech) return;

  const pending = new Map();
  let sequence = 0;
  port.onmessage = event => {
    try {
      const reply = JSON.parse(event.data);
      const request = pending.get(reply.id);
      if (!request) return;
      pending.delete(reply.id);
      clearTimeout(request.timer);
      if (request.kind === 'speech' && reply.status === 'finished') request.resolve({ status: 'finished' });
      else if (request.kind === 'stop' && reply.status === 'stopped') request.resolve({ status: 'stopped' });
      else request.reject(new Error('Native speech ' + (reply.status || 'failed')));
    } catch (_) {
      // Ignore malformed replies; the request timeout will reject instead.
    }
  };

  function speak(text, lang = 'en-US', rate = 0.85) {
    return new Promise((resolve, reject) => {
      if (typeof text !== 'string' || !text.trim() || text.length > 300 ||
          (lang !== 'en-US' && lang !== 'en-GB') ||
          typeof rate !== 'number' || !Number.isFinite(rate) || rate < 0.5 || rate > 1.25) {
        reject(new Error('Invalid native speech request'));
        return;
      }
      const id = 's' + (++sequence);
      const timer = setTimeout(() => {
        pending.delete(id);
        stop().catch(() => {});
        reject(new Error('Native speech timed out'));
      }, 45000);
      pending.set(id, { kind: 'speech', resolve, reject, timer });
      try {
        port.postMessage(JSON.stringify({ type: 'speak', id, text, lang, rate }));
      } catch (error) {
        pending.delete(id);
        clearTimeout(timer);
        reject(error);
      }
    });
  }

  function stop() {
    return new Promise((resolve, reject) => {
      const id = 'c' + (++sequence);
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('Native speech stop timed out'));
      }, 3000);
      pending.set(id, { kind: 'stop', resolve, reject, timer });
      try { port.postMessage(JSON.stringify({ type: 'stop', id })); }
      catch (error) { pending.delete(id); clearTimeout(timer); reject(error); }
    });
  }

  Object.defineProperty(window, 'OrunVocaSpeech', {
    value: Object.freeze({ speak, stop }), writable: false, configurable: false
  });
  window.addEventListener('pagehide', () => { stop().catch(() => {}); });
})();
