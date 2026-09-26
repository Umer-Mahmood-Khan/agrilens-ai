import { labRating, phValue } from '/soil.mjs';
const $ = (id) => document.getElementById(id);
const state = { mode: 'live', busy: false, config: null, analysis: null, result: null, controller: null, photo: null, report: null, previewUrl: null, resumeId: null };
const escape = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const list = values => `<ul>${values.map(v => `<li>${escape(v)}</li>`).join('')}</ul>`;
const sourceHtml = source => `<article class="source-card" id="source-${escape(source.id)}"><span>${escape(source.id)} · ${escape(source.topic)}</span><h3>${escape(source.title)}</h3><p>${escape(source.text)}</p><p class="scope">${escape(source.scope)}</p><a href="${escape(source.url)}" target="_blank" rel="noopener noreferrer">${escape(source.publisher)} ↗</a></article>`;
function error(message) { $('error-banner').textContent = message; $('error-banner').hidden = !message; if (message) $('error-banner').scrollIntoView({ behavior: 'smooth', block: 'center' }); }
function resetStages() {
  document.querySelectorAll('[data-stage]').forEach(row => { delete row.dataset.status; row.querySelector('.stage-state').textContent = 'Waiting'; row.querySelector('.stage-mark').textContent = '○'; });
  $('overall-status').textContent = 'Ready';
}
function stage(event) {
  const row = document.querySelector(`[data-stage="${event.stage}"]`);
  if (!row) return;
  row.dataset.status = event.status;
  row.querySelector('.stage-state').textContent = event.detail;
  row.querySelector('.stage-mark').textContent = ({ complete: '✓', running: '◌', skipped: '—', error: '!' })[event.status] || '○';
  $('progress-announcement').textContent = `${row.querySelector('strong').textContent}: ${event.detail}`;
}
function busy(value) {
  state.busy = value;
  for (const id of ['analyze-button', 'sample-top', 'sample-mode', 'live-mode', 'add-reading', 'confirm-readings', 'clear-photo', 'clear-report']) $(id).disabled = value;
  $('field-inputs').disabled = value || state.mode === 'sample';
  document.querySelectorAll('#soil-readings input, #soil-readings button').forEach(el => el.disabled = value);
  $('plan-button').disabled = value || !$('confirm-readings').checked;
  $('cancel-button').hidden = !value;
  if (value) $('overall-status').textContent = 'Working';
}
function clearResults() {
  state.analysis = null; state.result = null; state.resumeId = null;
  $('partial-findings').hidden = true;
  $('analyze-button').textContent = state.mode === 'sample' ? 'Explore sample findings ↗' : 'Analyze my field ↗';
  $('plan-button').textContent = 'Create action plan ↗';
  $('findings').hidden = true; $('results').hidden = true;
  $('confirm-readings').checked = false; $('plan-button').disabled = true;
  $('strip-review').classList.remove('current'); $('strip-plan').classList.remove('current');
  resetStages();
}
function updatePrivacyNote() {
  $('privacy-note').textContent = state.mode === 'sample'
    ? 'A fictional wheat scenario. Your selected files are not used or uploaded.'
    : `Live analysis sends your files to ${state.config?.providerLabel || 'your configured AI provider'}. Uploads are not saved to disk.${state.config?.provider === 'gemini' ? ' Free-tier content may be used to improve Google products; use non-sensitive demo reports.' : ''}`;
}
function mode(value) {
  if (state.busy) return;
  state.mode = value; clearResults(); error('');
  ['live', 'sample'].forEach(m => { $(`${m}-mode`).classList.toggle('selected', value === m); $(`${m}-mode`).setAttribute('aria-pressed', String(value === m)); });
  $('field-inputs').disabled = value === 'sample';
  $('sample-notice').hidden = value !== 'sample';
  $('analyze-button').textContent = value === 'sample' ? 'Explore sample findings ↗' : 'Analyze my field ↗';
  updatePrivacyNote();
}
async function receive(path, data) {
  state.controller = new AbortController();
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data), signal: state.controller.signal });
  if (!response.ok) { const body = await response.json(); throw Object.assign(new Error(body.error || 'Request failed.'), { status: response.status }); }
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ''; let final = null;
  function processLine(line) {
    if (!line.trim()) return;
    const event = JSON.parse(line);
    if (event.type === 'session') state.resumeId = event.id;
    if (event.type === 'finding' && event.stage === 'vision') {
      $('partial-findings').hidden = false;
      $('partial-summary').textContent = event.summary;
      $('partial-observations').innerHTML = list(event.observations);
    }
    if (event.type === 'error') { if (event.stage) stage({ stage: event.stage, status: 'error', detail: 'Paused — resume to retry this stage' }); throw Object.assign(new Error(event.error), { status: event.status }); }
    if (event.type === 'stage') stage(event);
    if (event.type === 'analysis' || event.type === 'result') final = event;
  }
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) { processLine(buffer.slice(0, index)); buffer = buffer.slice(index + 1); }
    if (done) { if (buffer.trim()) processLine(buffer); break; }
  }
  if (!final) throw new Error('The connection ended before a result arrived. Please retry.');
  return final;
}
function onFailure(e) {
  if ([409, 410].includes(e.status)) { clearResults(); }
  const resumable = Boolean(state.resumeId || state.analysis);
  const detail = e.name === 'AbortError' ? 'Analysis cancelled.' : e instanceof TypeError ? 'The connection was interrupted.' : e.message;
  const message = `${detail}${resumable ? ' Keep this page open: completed stages are saved for 30 minutes while this server is running. Use Resume to retry the unfinished step.' : ''}`;
  if (state.resumeId) $('analyze-button').textContent = 'Resume analysis ↗';
  if (state.analysis) $('plan-button').textContent = 'Resume action plan ↗';
  error(message); $('overall-status').textContent = e.name === 'AbortError' ? 'Cancelled' : 'Needs attention';
  document.querySelectorAll('[data-status="running"]').forEach(row => stage({ stage: row.dataset.stage, status: 'error', detail: e.name === 'AbortError' ? 'Cancelled' : 'Could not complete' }));
}
function fileData(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve({ name: file.name, data: reader.result }); reader.onerror = () => reject(new Error('This file could not be read. Choose it again.')); reader.readAsDataURL(file); }); }
async function runAnalysis() {
  if (state.busy) return;
  error('');
  if (state.mode === 'live') {
    if (state.config?.liveEnabled === false) { error('Live analysis is turned off on this public demo. Choose Explore a sample, or run AgriLens locally with your own API key.'); return; }
    if (!state.config?.liveAvailable) { $('setup-dialog').showModal(); return; }
    if (!state.photo) { error('Choose a crop photo to start, or explore the sample walkthrough.'); return; }
  }
  if (!state.resumeId) clearResults();
  busy(true);
  try {
    const data = { mode: state.mode };
    if (state.resumeId) data.id = state.resumeId;
    if (state.mode === 'live') {
      data.context = { crop: $('crop').value, stage: $('stage').value, location: $('location').value, notes: $('notes').value };
      data.photo = await fileData(state.photo); data.report = state.report ? await fileData(state.report) : null;
    }
    state.analysis = await receive('/api/analyze', data);
    state.resumeId = null;
    $('partial-findings').hidden = true;
    $('analyze-button').textContent = 'Start a new analysis ↗';
    showFindings(state.analysis);
    $('overall-status').textContent = 'Your review';
  } catch (e) { onFailure(e); } finally { busy(false); }
}
function addReading(reading = { parameter: '', value: '', unit: '', reference: '', interpretation: '' }) {
  const tr = document.createElement('tr');
  for (const key of ['parameter', 'value', 'unit', 'reference', 'interpretation']) {
    const td = document.createElement('td'); const input = document.createElement('input');
    input.value = reading[key]; input.maxLength = 200; input.dataset.field = key; input.setAttribute('aria-label', `${key} for ${reading.parameter || 'new reading'}`); input.placeholder = ['unit', 'reference', 'interpretation'].includes(key) ? 'Not supplied' : key === 'value' ? 'Value' : 'Parameter';
    input.addEventListener('input', invalidatePlan); td.append(input); tr.append(td);
  }
  const td = document.createElement('td'); const remove = document.createElement('button');
  remove.className = 'icon-button'; remove.textContent = '×'; remove.setAttribute('aria-label', `Remove ${reading.parameter || 'soil'} reading`);
  remove.addEventListener('click', () => { tr.remove(); invalidatePlan(); }); td.append(remove); tr.append(td); $('soil-readings').append(tr);
}
function invalidatePlan() {
  $('plan-button').textContent = 'Create action plan ↗';
  state.result = null; $('results').hidden = true; $('confirm-readings').checked = false; $('plan-button').disabled = true; $('strip-plan').classList.remove('current');
  ['knowledge', 'recommendation', 'review'].forEach(s => stage({ stage: s, status: 'waiting', detail: 'Waiting for your review' }));
  $('overall-status').textContent = 'Your review';
}
function showFindings(data) {
  const v = data.vision;
  document.querySelectorAll('.sample-badge').forEach(el => el.hidden = data.mode !== 'sample');
  $('vision-findings').innerHTML = `<div class="observation-brief"><span class="section-number">${data.mode === 'sample' ? 'SAMPLE OBSERVATIONS' : 'PHOTO OBSERVATIONS - NOT A DIAGNOSIS'}</span><h3>${escape(v.summary)}</h3><details><summary>View observations & photo limits</summary>${list(v.observations)}${list(v.followUp)}${list(v.limitations)}</details></div>`;
  $('soil-summary').textContent = data.soil.summary;
  $('soil-readings').replaceChildren(); data.soil.readings.forEach(addReading);
  $('soil-warnings').innerHTML = list(data.soil.warnings);
  $('findings').hidden = false; $('strip-review').classList.add('current');
  $('findings').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function readings() { return [...$('soil-readings').rows].map(row => Object.fromEntries([...row.querySelectorAll('input')].map(input => [input.dataset.field, input.value.trim()]))); }
async function runPlan() {
  if (state.busy || !state.analysis || !$('confirm-readings').checked) return;
  error('');
  const soil = readings();
  if (soil.some(r => !r.parameter || !r.value)) { error('Each soil row needs a parameter and value. Remove any unused rows.'); return; }
  busy(true); $('results').hidden = true; state.result = null;
  try {
    state.result = await receive('/api/plan', { id: state.analysis.id, readings: soil });
    showResult(state.result); $('overall-status').textContent = 'Complete';
    $('plan-button').textContent = 'View action plan again ↗';
  } catch (e) { onFailure(e); } finally { busy(false); }
}
function soilVisual(readings) {
  if (!readings.length) return '<div class="empty-chart"><span>+</span><h3>No soil measurements yet</h3><p>Add a lab report to see your soil snapshot.</p></div>';
  const categories = ['Low', 'Medium', 'Adequate', 'High', 'Unrated'];
  const rows = readings.map(r => {
    const rating = labRating(r);
    const ph = phValue(r);
    return '<div class="soil-viz-row"><div><strong>' + escape(r.parameter) + '</strong><small>' + escape(r.value) + ' ' + escape(r.unit) + '</small></div>' +
      (ph !== null ? '<div class="ph-chart"><svg viewBox="0 0 280 38" role="img" aria-label="Reported pH ' + ph + ' on a 0 to 14 scale"><line x1="10" y1="10" x2="270" y2="10" stroke="#dce4d9" stroke-width="5" stroke-linecap="round"/><line x1="140" y1="3" x2="140" y2="17" stroke="#7b8a7c"/><circle cx="' + (10 + ph / 14 * 260) + '" cy="10" r="6" fill="#245a43"/><text x="10" y="33">0</text><text x="140" y="33" text-anchor="middle">7 - neutral</text><text x="270" y="33" text-anchor="end">14</text></svg><small>Reported pH - no crop target inferred</small></div>' :
      '<div class="rating-track" role="img" aria-label="' + escape(r.parameter) + ': ' + rating + ' laboratory rating">' + categories.map(c => '<div class="rating-cell ' + (c === rating ? 'selected rating-' + c.toLowerCase() : '') + '"><span></span><small>' + c + '</small></div>').join('') + '</div>') +
      '<details class="reading-detail"><summary>Report detail</summary><p>Reference: ' + escape(r.reference || 'Not supplied') + '</p><p>Lab interpretation: ' + escape(r.interpretation || 'Not supplied') + '</p></details></div>';
  });
  return rows.slice(0,6).join('') + (rows.length > 6 ? '<details><summary>Show ' + (rows.length - 6) + ' more readings</summary>' + rows.slice(6).join('') + '</details>' : '');
}
function showResult(result) {
  const { plan, review, sources } = result;
  const sample = result.mode === 'sample';
  const rated = result.confirmedSoil.filter(r => labRating(r) !== 'Unrated').length;
  $('result-content').innerHTML = `<div class="result-summary"><div class="result-meta"><span>${sample ? 'ILLUSTRATIVE SAMPLE' : 'YOUR FIELD BRIEF'}</span><span>Evidence checks needed</span></div><h3>Three steps. A clearer decision.</h3><p>${escape(plan.summary)}</p></div>
    <div class="brief-stats"><div><strong>${result.confirmedSoil.length}</strong><span>Confirmed soil entries</span></div><div><strong>${rated}</strong><span>Explicit lab ratings</span></div><div><strong>${sources.length}</strong><span>Supporting references</span></div></div>
    <div class="action-deck">${plan.actions.map((a,i) => `<article class="card next-action"><div class="action-top"><span class="step-index">0${i+1}</span><span class="priority">${escape(a.priority)}</span></div><h3>${escape(a.title)}</h3><p>${escape(a.detail)}</p><details><summary>Why this step?</summary><p>${escape(a.rationale)}</p><div class="source-chips">${a.sourceIds.map(id => { const source = sources.find(s => s.id === id); return source ? `<a href="${escape(source.url)}" target="_blank" rel="noopener noreferrer">${escape(source.publisher)} &nearr;</a>` : ''; }).join('')}</div></details></article>`).join('')}</div>
    <div class="snapshot-grid"><section class="card soil-snapshot"><div class="section-heading"><div><span class="section-number">YOUR REPORT, AT A GLANCE</span><h2>Soil snapshot</h2></div><span class="pill">${sample ? 'Sample data' : 'Confirmed readings'}</span></div><p class="muted">Dots reflect explicit lab ratings. They are categories, not nutrient quantities.</p>${soilVisual(result.confirmedSoil)}</section><section class="card evidence-next"><span class="section-number">BEFORE CHOOSING INPUTS</span><h2>Complete the picture</h2><p class="muted">Bring these to your local adviser.</p>${list(plan.missingInformation)}<div class="context-note"><strong>Application rates pending</strong><p>Local calibration is needed before fertilizer or irrigation amounts can be recommended.</p></div></section></div>
    <details class="card limitations"><summary>Scope & evidence checks</summary>${list([...review.notes, ...plan.limitations])}<p class="muted">${escape(plan.irrigation)} ${escape(plan.nutrition)}</p></details>
    <details class="card evidence-result"><summary>Explore the ${sources.length} supporting references</summary><div class="library-grid">${sources.map(sourceHtml).join('')}</div></details>`;
  $('results').hidden = false; $('strip-plan').classList.add('current'); $('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function markdown(result) {
  const { plan, vision, context, confirmedSoil, sources, review } = result;
  return [ '# AgriLens AI — Farm Action Plan', '', `Mode: ${result.mode === 'sample' ? 'ILLUSTRATIVE SAMPLE — no AI inference' : 'AI-extracted evidence; rule-based next steps'}`, `Generated: ${result.createdAt}`, `Crop: ${context.crop} | Stage: ${context.stage} | Location: ${context.location || 'Not supplied'}`, '', '## Summary', plan.summary, '', '## Photo observations', ...vision.observations.map(s => `- ${s}`), '', '', '## Confirmed soil readings', ...confirmedSoil.map(r => `- ${r.parameter}: ${r.value} ${r.unit} | Reference: ${r.reference || 'Not supplied'} | Interpretation: ${r.interpretation || 'Not supplied'}`), '', '## Actions', ...plan.actions.flatMap(a => [`### ${a.priority}: ${a.title}`, a.detail, `Reason: ${a.rationale}`, `Sources: ${a.sourceIds.join(', ')}`, '']), '## Irrigation', plan.irrigation, '', '## Nutrition', plan.nutrition, '', '## Missing information', ...plan.missingInformation.map(s => `- ${s}`), '', '## Review & limitations', review.verdict, ...[...review.notes, ...plan.limitations, ...vision.limitations, ...result.soil.warnings].map(s => `- ${s}`), '', '## Sources', ...sources.flatMap(s => [`### ${s.id}: ${s.title}`, s.text, `${s.publisher}: ${s.url}`, `Scope: ${s.scope}`, '']) ].join('\n');
}
function download(format) {
  if (!state.result) return;
  const text = format === 'json' ? JSON.stringify(state.result, null, 2) : markdown(state.result);
  const url = URL.createObjectURL(new Blob([text], { type: format === 'json' ? 'application/json' : 'text/markdown' }));
  const a = document.createElement('a'); a.href = url; a.download = `agrilens-${state.result.mode}-${new Date().toISOString().slice(0,10)}.${format}`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function selectFile(kind, file) {
  if (state.busy || state.mode === 'sample') return;
  if (file) {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', ...(kind === 'report' ? ['application/pdf'] : [])];
    if (!allowed.includes(file.type) || file.size > 8 * 1024 * 1024 || file.size === 0) { $(kind).value = ''; error(`Choose a ${kind === 'report' ? 'PDF, JPG, PNG or WebP' : 'JPG, PNG or WebP'} file between 1 byte and 8 MB.`); return; }
  }
  state[kind] = file || null; clearResults(); error('');
  $(`${kind}-name`).textContent = file ? file.name : kind === 'photo' ? 'Choose or drop a leaf photo' : 'Choose or drop your report';
  $(`clear-${kind}`).hidden = !file;
  if (!file) $(kind).value = '';
  if (kind === 'photo') { if (state.previewUrl) URL.revokeObjectURL(state.previewUrl); state.previewUrl = file ? URL.createObjectURL(file) : null; $('photo-preview').hidden = !file; if (file) $('photo-preview').src = state.previewUrl; else $('photo-preview').removeAttribute('src'); }
}
document.querySelector('a[href="#evidence-library"]').addEventListener('click', () => { $('evidence-library').open = true; });
$('farm-form').addEventListener('submit', e => { e.preventDefault(); runAnalysis(); });
$('plan-button').addEventListener('click', runPlan);
$('sample-top').addEventListener('click', () => { mode('sample'); runAnalysis(); });
$('sample-mode').addEventListener('click', () => mode('sample'));
$('live-mode').addEventListener('click', () => mode('live'));
$('cancel-button').addEventListener('click', () => state.controller?.abort());
$('confirm-readings').addEventListener('change', () => $('plan-button').disabled = !$('confirm-readings').checked || state.busy);
$('add-reading').addEventListener('click', () => { if ($('soil-readings').rows.length >= 40) { error('Maximum 40 readings.'); return; } addReading(); invalidatePlan(); $('soil-readings').lastElementChild.querySelector('input').focus(); });
$('setup-button').addEventListener('click', () => $('setup-dialog').showModal());
$('close-setup').addEventListener('click', () => $('setup-dialog').close());
$('download-md').addEventListener('click', () => download('md'));
$('download-json').addEventListener('click', () => download('json'));
for (const kind of ['photo', 'report']) {
  $(kind).addEventListener('change', () => selectFile(kind, $(kind).files[0]));
  $(`clear-${kind}`).addEventListener('click', () => selectFile(kind, null));
  const zone = $(`${kind}-zone`);
  zone.addEventListener('dragover', e => { e.preventDefault(); if (!state.busy && state.mode === 'live') zone.classList.add('dragging'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragging'));
  zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('dragging'); if (e.dataTransfer.files.length !== 1) { error('Drop one file at a time.'); return; } selectFile(kind, e.dataTransfer.files[0]); });
}
for (const id of ['stage', 'location', 'notes']) $(id).addEventListener('input', () => { if (state.analysis || state.resumeId) clearResults(); });
async function init() {
  const results = await Promise.allSettled([fetch('/api/config').then(r => { if (!r.ok) throw new Error(); return r.json(); }), fetch('/api/knowledge').then(r => { if (!r.ok) throw new Error(); return r.json(); })]);
  if (results[0].status === 'fulfilled') {
    state.config = results[0].value;
    $('connection').classList.toggle('live', state.config.liveAvailable);
    $('connection').innerHTML = `<i></i> ${state.config.liveAvailable ? `${escape(state.config.providerLabel)} key configured` : 'Sample ready · AI not configured'}`;
    $('connection').title = `${state.config.providerLabel} · ${state.config.model}. API access is checked when you analyze a file.`;
    $('setup-key-name').textContent = `${state.config.keyEnv}=`;
    $('provider-help').textContent = state.config.provider === 'gemini'
      ? 'Gemini free-tier access depends on your project and model quota. Uploaded files are sent to Google; free-tier content may be used to improve its products. Use non-sensitive demo reports. Set GEMINI_MODEL in .env to change the model.'
      : 'Live analysis uses the OpenAI API and sends uploaded files to OpenAI. API charges apply. Set OPENAI_MODEL in .env to change the model.';
    updatePrivacyNote();
    $('setup-banner').hidden = state.config.liveAvailable;
    if (state.config.liveEnabled === false) {
      $('connection').innerHTML = '<i></i> Public demo · sample mode';
      $('connection').title = 'Live AI analysis is disabled on this deployment.';
      $('setup-banner').querySelector('span').innerHTML = '<strong>This is a public demo.</strong> Explore the sample walkthrough. To analyze your own files, run AgriLens locally with your API key.';
      $('setup-button').hidden = true;
      mode('sample');
    }
  } else { $('connection').textContent = 'Server unavailable'; error('Could not connect to the server. Restart it and refresh this page.'); }
  if (results[1].status === 'fulfilled') { $('library-count').textContent = results[1].value.length + ' reference cards'; $('library-content').innerHTML = results[1].value.map(s => sourceHtml(s).replace(`id="source-${s.id}"`, `id="library-${s.id}"`)).join(''); }
  else $('library-content').textContent = 'The reference library could not be loaded. Refresh to retry.';
}
init();
