import { reportSceneError } from './controls.js';

// WebKit can report the document loaded before this module has run, so the scene's
// power and rate callbacks may not exist yet when the host first sends. The host waits
// for this message instead, sent once the scene has installed them.
const entry = document.querySelector('script[data-entry]').dataset.entry;
import(new URL(entry, document.baseURI).href)
  .then(() => {
    if (document.documentElement.dataset.motion === 'host')
      window.webkit?.messageHandlers?.ready?.postMessage(true);
  })
  .catch(reportSceneError);
