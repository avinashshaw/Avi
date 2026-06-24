// Embedded admin UI. Uses App Bridge (loaded via the CDN script with the
// shopify-api-key meta tag) to obtain a session token for authenticated
// requests to our /api routes.

const fileInput = document.getElementById('file');
const drop = document.getElementById('drop');
const fileName = document.getElementById('fileName');
const submit = document.getElementById('submit');
const form = document.getElementById('form');
const result = document.getElementById('result');
const resultBody = document.getElementById('resultBody');
const summaryBody = document.getElementById('summaryBody');

// Authenticated fetch — attaches the App Bridge session token so the server's
// validateAuthenticatedSession middleware accepts the request.
async function authFetch(url, options = {}) {
  const headers = new Headers(options.headers || {});
  if (window.shopify?.idToken) {
    headers.set('Authorization', `Bearer ${await window.shopify.idToken()}`);
  }
  return fetch(url, { ...options, headers });
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])
  );
}

// --- File picker / drag & drop ---------------------------------------------
function makeFileList(file) {
  const dt = new DataTransfer();
  dt.items.add(file);
  return dt.files;
}
function setFile(file) {
  if (!file) return;
  fileInput.files = makeFileList(file);
  fileName.textContent = file.name;
  submit.disabled = false;
}
fileInput.addEventListener('change', () => {
  const f = fileInput.files[0];
  fileName.textContent = f ? f.name : 'No file selected';
  submit.disabled = !f;
});
['dragenter', 'dragover'].forEach((e) =>
  drop.addEventListener(e, (ev) => {
    ev.preventDefault();
    drop.classList.add('over');
  })
);
['dragleave', 'drop'].forEach((e) =>
  drop.addEventListener(e, (ev) => {
    ev.preventDefault();
    drop.classList.remove('over');
  })
);
drop.addEventListener('drop', (ev) => {
  const f = ev.dataTransfer.files[0];
  if (f) setFile(f);
});

// --- Submit ----------------------------------------------------------------
form.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  submit.disabled = true;
  submit.textContent = 'Importing…';

  const data = new FormData();
  data.append('file', fileInput.files[0]);

  try {
    const res = await authFetch('/api/import', { method: 'POST', body: data });
    renderResult(await res.json());
    loadSummary();
  } catch (err) {
    renderResult({ ok: false, error: err.message });
  } finally {
    submit.disabled = false;
    submit.textContent = 'Import reviews';
  }
});

function renderResult(json) {
  result.hidden = false;

  if (!json.ok) {
    let html = `<div class="notice err">${esc(json.error || 'Import failed.')}</div>`;
    if (json.details?.length) {
      html += `<ul class="errlist">${json.details.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>`;
    }
    if (json.expected) {
      html += `<p class="schema"><b>Expected columns:</b> <code>${esc(json.expected.join(','))}</code></p>`;
    }
    resultBody.innerHTML = html;
    return;
  }

  const s = json.shopify || {};
  const shopifyNote = s.failed
    ? `<div class="notice warn">Shopify sync: ${s.synced} synced, ${s.failed} failed.</div>`
    : `<div class="notice ok">Shopify sync: ${s.synced} review(s) saved as metaobjects.</div>`;

  let errHtml = '';
  if (json.rowErrors?.length) {
    errHtml = `<div class="notice warn">${json.rowErrors.length} row(s) skipped.</div>
      <ul class="errlist">${json.rowErrors.slice(0, 20).map((e) => `<li>${esc(e)}</li>`).join('')}</ul>`;
  }

  const rows = (json.preview || [])
    .map(
      (r) => `<tr>
        <td class="stars">${'★'.repeat(r.rating)}</td>
        <td>${esc(r.handle)}</td>
        <td>${esc(r.author)}</td>
        <td>${esc(r.title)}</td>
        <td>${esc((r.content || '').slice(0, 70))}…</td>
        <td>${(r.images || []).length}</td>
      </tr>`
    )
    .join('');

  resultBody.innerHTML = `
    <div class="notice ok">Import complete.</div>
    <div class="stats">
      <div class="stat"><b>${json.parsed}</b><span>parsed</span></div>
      <div class="stat"><b>${json.added}</b><span>added</span></div>
      <div class="stat"><b>${json.duplicates}</b><span>duplicates</span></div>
      <div class="stat"><b>${json.totalStored}</b><span>total stored</span></div>
    </div>
    ${shopifyNote}
    ${errHtml}
    <h3>Preview</h3>
    <table>
      <thead><tr><th>Rating</th><th>Handle</th><th>Author</th><th>Title</th><th>Content</th><th>Imgs</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;

  if (window.shopify?.toast) window.shopify.toast.show(`Imported ${json.added} review(s)`);
}

// --- Summary of already-imported products ----------------------------------
async function loadSummary() {
  try {
    const res = await authFetch('/api/summary');
    const json = await res.json();
    const products = json.products || [];
    if (!products.length) {
      summaryBody.innerHTML = `<p class="muted">No reviews imported yet.</p>`;
      return;
    }
    summaryBody.innerHTML = `<table>
      <thead><tr><th>Product handle</th><th>Reviews</th><th>Avg rating</th></tr></thead>
      <tbody>${products
        .map(
          (p) => `<tr><td>${esc(p.handle)}</td><td>${p.count}</td>
            <td class="stars">${'★'.repeat(Math.round(p.average))} <span class="muted">${p.average}</span></td></tr>`
        )
        .join('')}</tbody></table>`;
  } catch {
    summaryBody.innerHTML = `<p class="muted">Could not load summary.</p>`;
  }
}

loadSummary();
