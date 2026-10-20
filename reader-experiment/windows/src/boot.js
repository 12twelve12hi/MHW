// Loaded before app.js as a classic script: reports errors that stop the page from starting (a module that fails to
// load, say) where the end-to-end test reads them. Outside test mode Rust ignores e2e_status, so this does nothing.
(() => {
  const report = (msg) => {
    if (document.body?.dataset.ready === '1') return; // app.js keeps its own log once it runs
    try {
      window.__TAURI__?.core?.invoke('e2e_status', { json: JSON.stringify({ bootError: String(msg), at: new Date().toISOString() }) })
        .catch(() => {});
    } catch { /* not in the app */ }
  };
  window.addEventListener('error', (e) => report(e.message || e.target?.src || 'error'), true);
  window.addEventListener('unhandledrejection', (e) => report(e.reason?.message ?? e.reason));
})();
