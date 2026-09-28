export const baseApiTemplate = (baseUrl = 'http://localhost:5000') => {
  const useCdn = process.env.NODE_ENV !== 'production';
  const tailwindInclude = useCdn
    ? '<script src="https://cdn.tailwindcss.com"></script>'
    : '<link rel="stylesheet" href="/assets/tailwind.css" />';

  return `<!doctype html>
<html lang="en" class="antialiased" data-theme="light">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Clinic Management Software — API</title>
  ${tailwindInclude}
  <style>
    pre { white-space: pre-wrap; word-break: break-word; }
    .icon { width: 18px; height: 18px; vertical-align: middle; margin-right: 6px; display: inline-block; }
    .logo-bounce { transform-origin: center; transition: transform 220ms ease; }
    .logo-bounce:hover { transform: scale(1.06) rotate(-6deg); }
    .schema-box { background: #f8fafc; border-radius: 6px; padding: 8px; font-size: 12px; color: #0f172a; max-height:160px; overflow:auto; }
    .json-ta { width:100%; min-height:96px; border:1px solid #e6e9ee; border-radius:6px; padding:8px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, "Roboto Mono", "Segoe UI Mono", monospace; font-size:13px; background:#fff; }
    .error-message { color: #dc2626; font-size: 0.85rem; margin-top: 0.25rem; }
    .collapsible { cursor:pointer; user-select:none; }
    .collapsible + .content { display:none; margin-top:8px; }
    .collapsible.open + .content { display:block; }
    .small-muted { font-size:12px; color:#6b7280; }
    /* Dark mode styles */
    [data-theme="dark"] body { background: #1e293b; color: #e2e8f0; }
    [data-theme="dark"] header { background: #2d3748; }
    [data-theme="dark"] .bg-white { background: #2d3748; }
    [data-theme="dark"] .bg-slate-50 { background: #1e293b; }
    [data-theme="dark"] .bg-slate-100 { background: #4b5563; }
    [data-theme="dark"] .text-slate-800 { color: #e2e8f0; }
    [data-theme="dark"] .text-slate-500 { color: #94a3b8; }
    [data-theme="dark"] .schema-box { background: #334155; color: #e2e8f0; }
    [data-theme="dark"] .json-ta { background: #1e293b; color: #e2e8f0; border-color: #4b5563; }
    [data-theme="dark"] .bg-rose-50 { background: #7f1d1d; }
    [data-theme="dark"] .text-rose-700 { color: #f87171; }
    [data-theme="dark"] .bg-cyan-600 { background: #0891b2; }
    [data-theme="dark"] .hover\\:bg-slate-100:hover { background: #4b5563; }
  </style>
</head>
<body class="bg-slate-50 text-slate-800">
  <header class="bg-white shadow-sm">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between gap-4">
      <div class="flex items-center gap-3">
        <div id="logo" class="w-12 h-12 rounded-lg bg-gradient-to-br from-indigo-600 to-cyan-400 flex items-center justify-center text-white font-bold logo-bounce">CMS</div>
        <div>
          <h1 class="text-lg font-semibold">Clinic Management Software</h1>
          <p class="text-xs text-slate-500">Interactive API playground — JSON inputs</p>
        </div>
      </div>

      <div class="flex items-center gap-3">
        <button id="themeToggleBtn" class="flex items-center gap-2 px-3 py-2 rounded hover:bg-slate-100 text-sm">Toggle Theme</button>
        <button id="refreshDocsBtn" class="flex items-center gap-2 px-3 py-2 rounded hover:bg-slate-100 text-sm">Refresh</button>
        <div class="flex items-center gap-2">
          <input id="globalAuth" placeholder="Authorization (Bearer token)" class="w-64 border rounded px-2 py-2 text-sm" />
          <button id="saveAuth" class="px-3 py-2 rounded bg-emerald-600 text-white text-sm">Save</button>
        </div>
      </div>
    </div>
  </header>

  <main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 grid gap-6 lg:grid-cols-4">
    <aside id="leftPane" class="hidden lg:block lg:col-span-1">
      <div class="bg-white rounded-lg p-4 shadow-sm">
        <h3 class="font-semibold text-sm mb-2">Modules</h3>
        <div id="modulesList" class="space-y-2 text-sm"></div>
      </div>

      <div class="mt-4 bg-white rounded-lg p-4 shadow-sm">
        <h3 class="font-semibold text-sm mb-2">CORS</h3>
        <pre id="corsPre" class="text-xs p-2 rounded bg-slate-50 overflow-auto"></pre>
      </div>

      <div class="mt-4 bg-white rounded-lg p-4 shadow-sm">
        <h3 class="font-semibold text-sm mb-2">Recent Errors</h3>
        <div id="errorsList" class="space-y-2 text-sm max-h-72 overflow-auto"></div>
      </div>
    </aside>

    <section id="mainContent" class="lg:col-span-3 space-y-6">
      <div class="bg-white rounded-lg p-4 shadow-sm flex items-center justify-between gap-4">
        <div>
          <h2 class="text-lg font-semibold">API Playground (JSON)</h2>
          <p class="text-sm text-slate-500">Provide params/query/body as JSON and call endpoints</p>
        </div>
        <div class="text-sm small-muted">Tip: Provide an object for params (keys replace :param in path).</div>
      </div>

      <div class="bg-white rounded-lg p-4 shadow-sm">
        <div class="flex items-center justify-between">
          <h3 class="font-semibold text-sm">Routes</h3>
          <div class="flex items-center gap-2">
            <button id="expandAllBtn" class="px-3 py-1 rounded border text-sm">Expand all</button>
            <button id="collapseAllBtn" class="px-3 py-1 rounded border text-sm">Collapse all</button>
          </div>
        </div>

        <div id="routesWrap" class="mt-4 space-y-4"></div>
      </div>
    </section>
  </main>

  <footer class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 text-center text-sm text-slate-500">
    © <span id="year"></span> Clinic Management Software — API docs
  </footer>

<script>
(function () {
  const BASE = ${JSON.stringify(baseUrl)};
  document.getElementById('year').textContent = new Date().getFullYear();

  // Theme toggle functionality
  const htmlEl = document.documentElement;
  const themeToggleBtn = document.getElementById('themeToggleBtn');
  function setTheme(theme) {
    htmlEl.setAttribute('data-theme', theme);
    localStorage.setItem('cms_theme', theme);
    themeToggleBtn.textContent = theme === 'light' ? 'Dark Mode' : 'Light Mode';
  }
  // Restore theme from localStorage or default to light
  const savedTheme = localStorage.getItem('cms_theme') || 'light';
  setTheme(savedTheme);
  // Toggle theme on button click
  themeToggleBtn.addEventListener('click', () => {
    const currentTheme = htmlEl.getAttribute('data-theme') || 'light';
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
  });

  function escapeHtml(s){ if (s===undefined||s===null) return ''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  function isObject(v){ return v && typeof v === 'object' && !Array.isArray(v); }

  // ✅ Minimal addition: persist editor values (no other changes)
  function attachPersistence(textarea, key) {
    try {
      const saved = localStorage.getItem(key);
      if (saved !== null) textarea.value = saved;
      textarea.addEventListener("input", () => {
        localStorage.setItem(key, textarea.value);
      });
    } catch (e) { /* ignore storage errors */ }
  }

  // validation (re-usable)
  function validateValueAgainstMeta(value, meta, path){
    const errors = [];
    const p = path || '';
    if(!meta) return errors;
    if(meta.type === 'any') return errors;
    if((value===undefined||value===null||value==='') && !meta.optional){
      errors.push((p||'value') + ' is required');
      return errors;
    }
    if(value===undefined||value===null||value==='') return errors;
    switch(meta.type){
      case 'string':
        if(typeof value!=='string') errors.push(p+' must be a string');
        else {
          if(meta.minLength && value.length < meta.minLength) errors.push(p+' must be at least '+meta.minLength+' characters');
          if(meta.maxLength && value.length > meta.maxLength) errors.push(p+' must be at most '+meta.maxLength+' characters');
          if(meta.format === 'email'){ const re = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/; if(!re.test(value)) errors.push(p+' must be a valid email'); }
          if(meta.format === 'uuid'){ const uuidRe = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/; if(!uuidRe.test(value)) errors.push(p+' must be a valid UUID'); }
        }
        break;
      case 'number':
        if(typeof value !== 'number' || isNaN(value)) errors.push(p+' must be a number');
        else {
          if(meta.min!=null && value < meta.min) errors.push(p+' must be >= '+meta.min);
          if(meta.max!=null && value > meta.max) errors.push(p+' must be <= '+meta.max);
        }
        break;
      case 'boolean':
        if(typeof value !== 'boolean') errors.push(p+' must be a boolean');
        break;
      case 'enum':
        if(!meta.options || !Array.isArray(meta.options)) break;
        if(!meta.options.includes(value)) errors.push(p+' must be one of: '+meta.options.join(', '));
        break;
      case 'object':
        if(!isObject(value)) errors.push(p+' must be an object');
        else {
          const props = meta.properties || {};
          Object.keys(props).forEach(k => {
            const subMeta = props[k];
            const subVal = value[k];
            const subPath = p ? p+'.'+k : k;
            errors.push(...validateValueAgainstMeta(subVal, subMeta, subPath));
          });
        }
        break;
      case 'array':
        if(!Array.isArray(value)) errors.push(p+' must be an array');
        else {
          if(meta.minItems && value.length < meta.minItems) errors.push(p+' must have at least '+meta.minItems+' items');
          const itemMeta = meta.items || {};
          value.forEach((it, idx) => {
            errors.push(...validateValueAgainstMeta(it, itemMeta, p+'['+idx+']'));
          });
        }
        break;
      default:
        break;
    }
    return errors;
  }

  // show a compact schema preview (JSON)
  function renderSchemaPreview(schema){
    try { return escapeHtml(JSON.stringify(schema, null, 2)); }
    catch(e){ return escapeHtml(String(schema)); }
  }

  // Build UI route cards — using JSON textareas for params/query/body
  function renderRoutes(endpoints){
    const wrap = document.getElementById('routesWrap');
    wrap.innerHTML = '';
    if(!Array.isArray(endpoints) || !endpoints.length){
      wrap.innerHTML = '<div class="p-4 rounded bg-slate-50 text-sm text-slate-500">No endpoints discovered</div>';
      return;
    }

    const grouped = {};
    endpoints.forEach(ep => {
      const mod = (Array.isArray(ep.tags) && ep.tags.length) ? ep.tags[0] : 'root';
      grouped[mod] = grouped[mod] || [];
      grouped[mod].push(ep);
    });

    // modules list
    const modulesList = document.getElementById('modulesList');
    modulesList.innerHTML = '';
    Object.keys(grouped).sort().forEach(m => {
      const btn = document.createElement('button');
      btn.className = 'w-full text-left px-2 py-1 rounded hover:bg-slate-100';
      btn.textContent = m + ' (' + grouped[m].length + ')';
      btn.addEventListener('click', () => {
        const el = document.querySelector('[data-module="'+CSS.escape(m)+'"]');
        if(el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      modulesList.appendChild(btn);
    });

    // endpoint cards
    Object.keys(grouped).sort().forEach(moduleName => {
      const moduleDiv = document.createElement('div');
      moduleDiv.setAttribute('data-module', moduleName);
      moduleDiv.className = 'mt-6';
      const h3 = document.createElement('h3');
      h3.className = 'text-base font-semibold mb-3';
      h3.textContent = moduleName;
      moduleDiv.appendChild(h3);

      grouped[moduleName].forEach(ep => {
        const epBox = document.createElement('div');
        epBox.className = 'bg-white rounded-lg p-4 shadow-sm mb-3';

        // header
        const header = document.createElement('div');
        header.className = 'flex items-start justify-between gap-4';
        const left = document.createElement('div');
        left.className = 'flex-1 min-w-0';
        const badge = document.createElement('div');
        badge.className = 'inline-block px-2 py-1 rounded text-xs font-semibold bg-slate-100 text-slate-800 mr-3';
        badge.textContent = (ep.method||'GET').toUpperCase();
        const pathEl = document.createElement('div');
        pathEl.className = 'font-mono text-sm truncate';
        pathEl.textContent = ep.path || '';
        left.appendChild(badge);
        left.appendChild(pathEl);
        const desc = document.createElement('div');
        desc.className = 'text-sm text-slate-500 mt-2';
        desc.textContent = ep.description || '';
        left.appendChild(desc);
        header.appendChild(left);

        const actions = document.createElement('div');
        actions.className = 'flex flex-col items-end gap-2';
        const callBtn = document.createElement('button');
        callBtn.className = 'flex items-center gap-2 px-3 py-2 rounded bg-cyan-600 text-white text-sm';
        callBtn.innerHTML = 'Call';
        const curlBtn = document.createElement('button');
        curlBtn.className = 'flex items-center gap-2 px-3 py-2 rounded border text-sm';
        curlBtn.innerHTML = 'cURL';
        const copyRespBtn = document.createElement('button');
        copyRespBtn.className = 'copy-resp-btn flex items-center gap-2 px-3 py-2 rounded border text-sm';
        copyRespBtn.innerHTML = 'Copy Response';
        actions.appendChild(callBtn);
        actions.appendChild(curlBtn);
        actions.appendChild(copyRespBtn);
        header.appendChild(actions);
        epBox.appendChild(header);

        // schema preview (collapsed)
        const schemaToggle = document.createElement('div');
        schemaToggle.className = 'mt-3 collapsible font-medium';
        schemaToggle.textContent = 'Show schema preview';
        const schemaContent = document.createElement('div');
        schemaContent.className = 'content';
        const schemaHtml = document.createElement('div');
        schemaHtml.className = 'grid grid-cols-3 gap-3';
        // params schema
        const paramsBox = document.createElement('div');
        paramsBox.innerHTML = '<div class="small-muted">Path params schema</div><pre class="schema-box">'+renderSchemaPreview(ep.params || { type: "any" })+'</pre>';
        // query schema
        const queryBox = document.createElement('div');
        queryBox.innerHTML = '<div class="small-muted">Query params schema</div><pre class="schema-box">'+renderSchemaPreview(ep.query || { type: "any" })+'</pre>';
        // body schema
        const bodyBox = document.createElement('div');
        bodyBox.innerHTML = '<div class="small-muted">Request body schema</div><pre class="schema-box">'+renderSchemaPreview(ep.requestSchema || { type: "any" })+'</pre>';
        schemaHtml.appendChild(paramsBox);
        schemaHtml.appendChild(queryBox);
        schemaHtml.appendChild(bodyBox);
        schemaContent.appendChild(schemaHtml);
        schemaToggle.addEventListener('click', () => schemaToggle.classList.toggle('open'));
        schemaToggle.addEventListener('click', () => schemaContent.classList.toggle('open'));
        epBox.appendChild(schemaToggle);
        epBox.appendChild(schemaContent);

        // JSON editors: params, query, body
        const editors = document.createElement('div');
        editors.className = 'mt-3 grid gap-3 md:grid-cols-3';
        const paramsEditorWrap = document.createElement('div');
        paramsEditorWrap.innerHTML = '<div class="text-xs font-medium mb-2">Path params (JSON)</div><textarea class="json-ta" data-role="params_json" placeholder="{ \\"id\\": \\"abc\\" }"></textarea><div class="small-muted">Example: { "clinicId": "uuid-value" }</div>';
        const queryEditorWrap = document.createElement('div');
        queryEditorWrap.innerHTML = '<div class="text-xs font-medium mb-2">Query params (JSON)</div><textarea class="json-ta" data-role="query_json" placeholder="{ \\"page\\": 1 }"></textarea><div class="small-muted">Example: { "page": 1, "pageSize": 10 }</div>';
        const bodyEditorWrap = document.createElement('div');
        bodyEditorWrap.innerHTML = '<div class="text-xs font-medium mb-2">Request body (JSON)</div><textarea class="json-ta" data-role="body_json" placeholder="{ \\"clinicDetails\\": { \\"clinicName\\": \\"My Clinic\\" } }"></textarea><div class="small-muted">When schema is missing, paste example JSON</div>';
        editors.appendChild(paramsEditorWrap);
        editors.appendChild(queryEditorWrap);
        editors.appendChild(bodyEditorWrap);
        epBox.appendChild(editors);

        // ✅ Minimal addition: persist per-endpoint editors
        const keyBase = ((ep.method||'GET').toUpperCase() + ' ' + (ep.path||'')).trim();
        const paramsTa = paramsEditorWrap.querySelector('textarea');
        const queryTa  = queryEditorWrap.querySelector('textarea');
        const bodyTa   = bodyEditorWrap.querySelector('textarea');
        if (paramsTa) attachPersistence(paramsTa, keyBase + '::params');
        if (queryTa)  attachPersistence(queryTa,  keyBase + '::query');
        if (bodyTa)   attachPersistence(bodyTa,   keyBase + '::body');

        // response area
        const resp = document.createElement('pre');
        resp.className = 'p-3 mt-3 rounded bg-slate-50 text-sm apiResp';
        resp.style.maxHeight = '220px';
        resp.style.overflow = 'auto';
        epBox.appendChild(resp);

        // helper: parse JSON textarea, return {ok: true, value} or {ok:false, error}
        function parseJsonFrom(selector){
          const ta = epBox.querySelector('[data-role="'+selector+'"]');
          if(!ta) return { ok:true, value: {} };
          const raw = ta.value.trim();
          if(!raw) return { ok:true, value: {} };
          try { return { ok:true, value: JSON.parse(raw) }; }
          catch(e){ return { ok:false, error: 'Invalid JSON in '+selector+': '+(e.message||e) }; }
        }

        // call button
        callBtn.addEventListener('click', async () => {
          resp.textContent = 'Loading...';
          const parsedParams = parseJsonFrom('params_json');
          const parsedQuery = parseJsonFrom('query_json');
          const parsedBody = parseJsonFrom('body_json');
          if(!parsedParams.ok){ resp.textContent = parsedParams.error; pushUiError({ path: ep.path, method: ep.method, message: parsedParams.error }); return; }
          if(!parsedQuery.ok){ resp.textContent = parsedQuery.error; pushUiError({ path: ep.path, method: ep.method, message: parsedQuery.error }); return; }
          if(!parsedBody.ok){ resp.textContent = parsedBody.error; pushUiError({ path: ep.path, method: ep.method, message: parsedBody.error }); return; }

          // optional: run schema validation for top-level props using validateValueAgainstMeta
          const schemaParam = ep.params || { type: 'any' };
          const schemaQuery = ep.query || { type: 'any' };
          const schemaBody = ep.requestSchema || { type: 'any' };

          const paramErrors = validateValueAgainstMeta(parsedParams.value, schemaParam, 'params');
          const queryErrors = validateValueAgainstMeta(parsedQuery.value, schemaQuery, 'query');
          const bodyErrors = validateValueAgainstMeta(parsedBody.value, schemaBody, 'body');
          const allErrors = [].concat(paramErrors, queryErrors, bodyErrors);
          if(allErrors.length){ resp.textContent = 'Validation errors:\\n' + allErrors.join('\\n'); pushUiError({ path: ep.path, method: ep.method, message: 'Validation errors: '+allErrors.join('; ') }); return; }

          // build path replacement for :param values
          let finalPath = ep.path || '';
          if(parsedParams.value && typeof parsedParams.value === 'object'){
            Object.keys(parsedParams.value).forEach(k => {
              const v = parsedParams.value[k];
              finalPath = finalPath.replace(':'+k, encodeURIComponent(String(v)));
            });
          }

          const qs = parsedQuery.value && Object.keys(parsedQuery.value).length ? ('?' + Object.keys(parsedQuery.value).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(String(parsedQuery.value[k]))).join('&')) : '';

          const headers = { 'Content-Type': 'application/json' };
          const auth = document.getElementById('globalAuth')?.value?.trim() || '';
          if(auth) headers.Authorization = auth;

          try {
            const method = (ep.method || 'GET').toUpperCase();
            const opts = { method, headers };
            if(method !== 'GET' && method !== 'HEAD' && parsedBody.value && Object.keys(parsedBody.value).length) opts.body = JSON.stringify(parsedBody.value);
            const res = await fetch(BASE.replace(/\\/$/, '') + finalPath + qs, opts);
            let out;
            try { out = await res.json(); } catch(e) { out = await res.text(); }
            resp.textContent = typeof out === 'string' ? out : JSON.stringify(out, null, 2);
            if(!res.ok) pushUiError({ path: finalPath, method, status: res.status, message: (out && out.message) ? out.message : JSON.stringify(out) });
          } catch(err){
            resp.textContent = 'Error: '+(err.message || String(err));
            pushUiError({ path: ep.path||'', method: ep.method||'', message: err.message || String(err) });
          }
        });

        // cURL button — uses parsed JSON; constructs safe string with simple concatenation
        curlBtn.addEventListener('click', () => {
          const parsedParams = parseJsonFrom('params_json'); if(!parsedParams.ok){ pushUiError({ path: ep.path, method: ep.method, message: parsedParams.error }); return; }
          const parsedQuery = parseJsonFrom('query_json'); if(!parsedQuery.ok){ pushUiError({ path: ep.path, method: ep.method, message: parsedQuery.error }); return; }
          const parsedBody = parseJsonFrom('body_json'); if(!parsedBody.ok){ pushUiError({ path: ep.path, method: ep.method, message: parsedBody.error }); return; }

          let finalPath = ep.path || '';
          if(parsedParams.value && typeof parsedParams.value === 'object'){
            Object.keys(parsedParams.value).forEach(k => { finalPath = finalPath.replace(':'+k, encodeURIComponent(String(parsedParams.value[k]))); });
          }
          const qs = parsedQuery.value && Object.keys(parsedQuery.value).length ? ('?' + Object.keys(parsedQuery.value).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(String(parsedQuery.value[k]))).join('&')) : '';
          const auth = document.getElementById('globalAuth')?.value?.trim() || '';
          const method = (ep.method || 'GET').toUpperCase();

          let curl = "curl -X " + method + " '" + BASE.replace(/\\/$/, '') + finalPath + qs + "' -H 'Content-Type: application/json'";
          if(auth) curl += " -H 'Authorization: " + auth.replace(/'/g, "\\'") + "'";
          if(parsedBody.value && Object.keys(parsedBody.value).length && method !== 'GET') curl += " -d '" + JSON.stringify(parsedBody.value).replace(/'/g, "\\'") + "'";

          navigator.clipboard.writeText(curl).then(() => {
            curlBtn.textContent = 'Copied';
            setTimeout(() => curlBtn.textContent = 'cURL', 900);
          }).catch(err => {
            pushUiError({ path: ep.path, method: ep.method, message: 'Failed to copy cURL: '+(err.message||err) });
          });
        });

        copyRespBtn.addEventListener('click', () => {
          const text = resp.textContent || '';
          navigator.clipboard.writeText(text).then(() => {
            copyRespBtn.textContent = 'Copied';
            setTimeout(() => copyRespBtn.textContent = 'Copy Response', 900);
          }).catch(err => { pushUiError({ path: ep.path, method: ep.method, message: 'Failed to copy response' }); });
        });

        moduleDiv.appendChild(epBox);
      });

      wrap.appendChild(moduleDiv);
    });

    document.getElementById('expandAllBtn').addEventListener('click', () => {
      document.querySelectorAll('.collapsible').forEach(n => { n.classList.add('open'); const c = n.nextElementSibling; if(c) c.classList.add('open'); });
    });
    document.getElementById('collapseAllBtn').addEventListener('click', () => {
      document.querySelectorAll('.collapsible').forEach(n => { n.classList.remove('open'); const c = n.nextElementSibling; if(c) c.classList.remove('open'); });
    });
  }

  function pushUiError(err){
    window.__DOCS_UI_ERRORS = window.__DOCS_UI_ERRORS || [];
    window.__DOCS_UI_ERRORS.unshift({ time: new Date().toISOString(), path: err.path||'', method: err.method||'', message: err.message||'Unknown', status: err.status||undefined });
    window.__DOCS_UI_ERRORS = window.__DOCS_UI_ERRORS.slice(0,100);
    renderErrors();
  }

  function renderErrors(){
    const list = document.getElementById('errorsList');
    list.innerHTML = '';
    const serverErrors = Array.isArray(window.__DOCS_DATA?.errors) ? window.__DOCS_DATA.errors.slice() : [];
    const uiErrors = Array.isArray(window.__DOCS_UI_ERRORS) ? window.__DOCS_UI_ERRORS.slice() : [];
    const combined = uiErrors.concat(serverErrors).slice(0,100).sort((a,b)=> new Date(b.time||0) - new Date(a.time||0));
    if(!combined.length){ list.innerHTML = '<div class="text-sm text-slate-500">No recent errors</div>'; return; }
    combined.forEach(e=>{
      const el = document.createElement('div');
      el.className = 'p-2 rounded border bg-white mb-2';
      el.innerHTML = '<div class="font-medium mb-1"><span class="text-xs inline-block mr-2 px-2 py-1 rounded bg-rose-50 text-rose-700">'+escapeHtml(e.method||'')+'</span><span class="font-mono">'+escapeHtml(e.path||'')+'</span></div><div class="text-xs text-slate-500 mb-1">'+escapeHtml(e.time||'')+'</div><div><code>'+escapeHtml((e.status?('['+e.status+'] ') : '') + (e.message||''))+'</code></div>';
      list.appendChild(el);
    });
  }

  async function fetchDocs(){
    try{
      const res = await fetch(BASE.replace(/\\/$/, '') + '/docs/json', { cache:'no-store' });
      if(!res.ok) throw new Error('Failed to fetch /docs/json: ' + res.status);
      const data = await res.json();
      window.__DOCS_DATA = data || {};
      const endpoints = Array.isArray(window.__DOCS_DATA.endpoints) ? window.__DOCS_DATA.endpoints : [];
      endpoints.sort((a,b) => { if(a.registeredAt && b.registeredAt) return new Date(b.registeredAt) - new Date(a.registeredAt); return (a.path||'').localeCompare(b.path||''); });
      const corsPre = document.getElementById('corsPre');
      try { corsPre.textContent = JSON.stringify(window.__DOCS_DATA.cors || {}, null, 2); } catch(e) { corsPre.textContent = String(window.__DOCS_DATA.cors); }
      renderRoutes(endpoints);
      renderErrors();
    }catch(err){
      console.error('fetchDocs error', err);
      pushUiError({ message: 'Failed to load docs: ' + (err.message||String(err)) });
      const wrap = document.getElementById('routesWrap');
      wrap.innerHTML = '<div class="p-4 rounded bg-rose-50 text-rose-700">Unable to load docs: ' + escapeHtml(err.message||String(err)) + '</div>';
    }
  }

  document.getElementById('refreshDocsBtn').addEventListener('click', fetchDocs);
  document.getElementById('saveAuth').addEventListener('click', () => {
    const v = document.getElementById('globalAuth').value.trim();
    if(v) localStorage.setItem('cms_token', v);
  });
  (function restoreToken(){ const t = localStorage.getItem('cms_token'); if(t) document.getElementById('globalAuth').value = t; })();

  fetchDocs();
})();
</script>
</body>
</html>`;
};
