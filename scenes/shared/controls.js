import { qualityName } from './render-policy.js';
import { setActionIcon } from '../../ui/icons.js';

export function preferredQuality(params) {
  let saved;
  try { saved = localStorage.getItem('deskworlds-quality'); } catch {}
  return qualityName(params.get('quality') || saved || (navigator.connection?.saveData ? 'eco' : 'balanced'));
}

export function installControls({ stage, isPaused, isRunning, pause, feed, quality, setQuality }) {
  document.querySelectorAll('.chrome button, .chrome select, #show-controls').forEach(element => { element.disabled = false; });
  const pauseButton = document.querySelector('#pause');
  const feedButton = document.querySelector('#feed');
  const select = document.querySelector('#quality');
  const fullscreenButton = document.querySelector('#fullscreen');
  setActionIcon(feedButton, 'feed', 'Feed');
  function refreshFullscreen() {
    const active = Boolean(document.fullscreenElement);
    setActionIcon(fullscreenButton, active ? 'exit-fullscreen' : 'fullscreen', active ? 'Exit fullscreen' : 'Fullscreen', 'F');
  }
  document.addEventListener('fullscreenchange', refreshFullscreen);
  refreshFullscreen();
  function refresh() {
    if (pauseButton) {
      setActionIcon(pauseButton, isPaused() ? 'play' : 'pause', isPaused() ? 'Play' : 'Pause', 'Space');
      pauseButton.setAttribute('aria-pressed', String(isPaused()));
    }
    if (feedButton) feedButton.disabled = !isRunning();
    if (select) select.value = quality();
  }
  function clean(value) {
    document.body.classList.toggle('clean', value);
    document.querySelectorAll('.chrome').forEach(element => { element.inert = value; });
    document.querySelector(value ? '#show-controls' : '#hide')?.focus();
  }
  async function fullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await stage.requestFullscreen();
    } catch (error) { console.warn(error.message); }
  }
  pauseButton?.addEventListener('click', () => pause(!isPaused()));
  feedButton?.addEventListener('click', feed);
  fullscreenButton?.addEventListener('click', fullscreen);
  document.querySelector('#hide')?.addEventListener('click', () => clean(true));
  document.querySelector('#show-controls')?.addEventListener('click', () => clean(false));
  select?.addEventListener('change', () => {
    setQuality(select.value);
    try { localStorage.setItem('deskworlds-quality', select.value); } catch {}
    refresh();
  });
  document.addEventListener('keydown', event => {
    if (event.repeat || event.target.closest('button,select,input,textarea,a,[contenteditable]')) return;
    if (event.code === 'Space') { event.preventDefault(); pause(!isPaused()); }
    else if (event.key.toLowerCase() === 'f') fullscreen();
    else if (event.key.toLowerCase() === 'h') clean(!document.body.classList.contains('clean'));
  });
  document.querySelectorAll('.chrome').forEach(element => { element.inert = document.body.classList.contains('clean'); });
  refresh();
  return refresh;
}

export function reportSceneError(error) {
  console.error(error);
  const loading = document.querySelector('#loading');
  if (loading) loading.hidden = true;
  const box = document.querySelector('#error');
  if (!box) return;
  box.hidden = false;
  box.replaceChildren(document.createTextNode('This world could not start. '));
  const reload = document.createElement('a');
  reload.href = location.href;
  reload.textContent = 'Reload world';
  box.append(reload);
}
