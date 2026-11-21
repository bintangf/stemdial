const $ = selector => document.querySelector(selector);
const controls = $('#controls'), pitch = $('#pitch'), strength = $('#strength');
const power = $('#power'), state = $('#state');
const levels = {'1':100, '-1':100};
let active = false, tabId;
const mode = () => Number($('[name=mix]:checked').value);

function paint() {
  $('#reduction').hidden = mode() === 0;
  $('#reduceLabel').textContent = mode() === -1 ? 'Backing reduction' : 'Vocal reduction';
  strength.value = `${levels[mode()] ?? 0}%`;
  $('#amount').value = `${pitch.value > 0 ? '+' : ''}${pitch.value} st`;
  pitch.setAttribute('aria-valuetext', `${pitch.value} semitones`);
  for (const button of controls.querySelectorAll('[data-step]')) {
    const slider = document.getElementById(button.dataset.for);
    const down = Number(button.dataset.step)<0;
    button.disabled = slider===strength ? levels[mode()]===(down?0:100) : pitch.valueAsNumber===Number(down?pitch.min:pitch.max);
  }
}

function request(op) {
  return chrome.runtime.sendMessage({to:'panel',tabId,op,mode:mode(),strength:levels[mode()] ?? 0,pitch:pitch.valueAsNumber}).then(r => {
    if (!r || r.error) throw Error(r?.error || 'No response from the audio engine.');
    return r;
  });
}
const report = e => { state.textContent = `${e.message} Reopen the pedal on a music tab to retry.`; };
let engine = {state:null, message:''};
function engineText() {
  if (engine.state === 'ai' || engine.state === 'running') return `Local AI active.${engine.latency ? ` Audio delay ${engine.latency} ms.` : ''}`;
  if (engine.state === 'loading') return 'Preparing local AI…';
  if (engine.state === 'stereo') return `Stereo filter active${engine.message ? ` (${engine.message})` : ''}.`;
  if (engine.state === 'error') return `${engine.message || 'AI stopped'}.`;
  return engine.message || '';
}
function showState() {
  power.textContent = active ? 'Stop and restore audio' : 'Start on this tab';
  state.textContent = active ? (engineText() || 'Pedal on.') : 'Bypassed. This tab uses its original mix.';
}
let previewPending=false, previewBusy=false;
async function preview() {
  previewPending=true;
  if(previewBusy) return;
  previewBusy=true;
  try { while(previewPending && active){previewPending=false;await request('preview');} }
  catch(e){report(e);} finally {previewBusy=false;}
}
function commitEdit() {
  previewPending=false;
  paint();
  request('save').catch(report);
}
pitch.oninput=()=>{paint();if(active) preview();};
chrome.runtime.onMessage.addListener(m=>{
  if (m.to!=='panel' || m.op!=='engine') return;
  engine=m.engine||engine;
  if (active) showState();
});
controls.onchange=commitEdit;
for (const button of controls.querySelectorAll('[data-step]')) button.onclick = () => {
  const slider = document.getElementById(button.dataset.for);
  if (slider===strength) levels[mode()]=Math.max(0,Math.min(100,levels[mode()]+Number(button.dataset.step)));
  else slider.value = slider.valueAsNumber + Number(button.dataset.step);
  commitEdit();
};
power.onclick = async () => {
  controls.disabled = true;
  previewPending=false;
  state.textContent = active ? 'Restoring tab audio…' : 'Starting the pedal…';
  try { const r = await request(active ? 'stop' : 'apply'); active = r.active; engine = r.engine || engine; showState(); }
  catch(e) { report(e); }
  finally { controls.disabled = false; power.focus(); }
};
try {
  const [tab] = await chrome.tabs.query({active:true,lastFocusedWindow:true});
  tabId = tab.id;
  // Paint the saved mix first; the tab-specific answer arrives a moment later.
  const saved = await chrome.storage.local.get(['mix','reduction1','reduction-1']);
  const savedMix = saved.mix || {semitones:0,center:1,mode:1};
  const savedMode = savedMix.mode ?? Math.sign(savedMix.center);
  for (const id of [1,-1]) levels[id] = saved[`reduction${id}`] ?? 100;
  $(`[name=mix][value="${savedMode || 1}"]`).checked = true;
  pitch.value = savedMix.semitones || 0;
  paint(); controls.disabled = false;
  const [r,prefs] = await Promise.all([request('status'),chrome.storage.local.get(['reduction1','reduction-1'])]);
  const selected = r.mix.mode ?? Math.sign(r.mix.center);
  for (const id of [1,-1]) levels[id] = prefs[`reduction${id}`] ?? 100;
  if (r.active && selected) levels[selected] = Math.round(Math.abs(r.mix.center)*100);
  $(`[name=mix][value="${selected}"]`).checked = true;
  active = r.active; pitch.value = r.mix.semitones; engine = r.engine || engine;
  paint(); showState(); controls.disabled = false;
} catch(e) { report(e); }
