const fileInput = document.getElementById('file');
const drop = document.getElementById('drop');
const fileName = document.getElementById('fileName');
const submit = document.getElementById('submit');
const form = document.getElementById('form');
const result = document.getElementById('result');
const resultBody = document.getElementById('resultBody');

function setFile(file) {
  if (!file) return;
  fileInput.files = makeFileList(file);
  fileName.textContent = file.name;
  submit.disabled = false;
}

// DataTransfer trick so a dropped file populates the <input type=file>.
function makeFileList(file) {
  const dt = new DataTransfer();
  dt.items.add(file);
  return dt.files;
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

form.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  submit.disabled = true;
  submit.textContent = 'Importing…';

  const data = new FormData();
  data.append('file', fileInput.files[0]);
  const sync = document.getElementById('sync').checked;

  try {
    const res = await fetch(`/api/import?sync=${sync}`, {
      method: 'POST',
      body: data,
    });
    const json = await res.json();
    render(json);
  } catch (err) {
    render({ ok: false, error: err.message });
  } finally {
    submit.disabled = false;
    submit.textContent = 'Import reviews';
  }
});

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])
  );
}

function render(json) {
  result.hidden = false;
  result.scrollIntoView({ behavior: 'smooth' });

  if (!json.ok) {
    let html = `<div class="notice err">${esc(json.error || 'Import failed.')}</div>`;
    if (json.details?.length) {
      html += `<ul class="errlist">${json.details
        .map((d) => `<li>${esc(d)}</li>`)
        .join('')}</ul>`;
    }
    if (json.expected) {
      html += `<p class="schema"><b>Expected columns:</b> <code>${esc(
        json.expected.join(',')
      )}</code></p>`;
    }
    resultBody.innerHTML = html;
    return;
  }

  const s = json.shopify || {};
  let shopifyNote = '';
  if (!s.configured) {
    shopifyNote = `<div class="notice warn">Saved locally. Shopify sync is disabled — set SHOPIFY_* in <code>.env</code> to push reviews as metaobjects.</div>`;
  } else {
    shopifyNote = `<div class="notice ok">Shopify sync: ${s.synced} synced${
      s.failed ? `, ${s.failed} failed` : ''
    }.</div>`;
  }

  let errHtml = '';
  if (json.rowErrors?.length) {
    errHtml = `<div class="notice warn">${json.rowErrors.length} row(s) skipped.</div>
      <ul class="errlist">${json.rowErrors
        .slice(0, 20)
        .map((e) => `<li>${esc(e)}</li>`)
        .join('')}</ul>`;
  }

  const rows = (json.preview || [])
    .map(
      (r) => `<tr>
        <td>${'★'.repeat(r.rating)}</td>
        <td>${esc(r.handle)}</td>
        <td>${esc(r.author)}</td>
        <td>${esc(r.title)}</td>
        <td>${esc((r.content || '').slice(0, 80))}…</td>
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
    <h3>Preview (first ${json.preview.length})</h3>
    <table>
      <thead><tr><th>Rating</th><th>Handle</th><th>Author</th><th>Title</th><th>Content</th><th>Imgs</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}
