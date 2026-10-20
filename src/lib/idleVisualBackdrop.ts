/**
 * Visual-only frozen backdrop for the idle refresh dialog.
 *
 * React correctly unmounts its operational subtree on inactivity to stop
 * polling and Realtime traffic. A normal backdrop-filter would therefore blur
 * an empty screen. Before that unmount, copy the *already rendered* DOM once.
 *
 * The copy has no React listeners, scripts, forms, playable content or focus
 * targets. It is inert, inaccessible to assistive technology, and never
 * persisted. It exists solely as an atmospheric blurred background until the
 * user reloads the document. No data requests or app state changes are made.
 */
const BACKDROP_ID = 'hotelcare-idle-frozen-workspace';

export function clearIdleVisualBackdrop(): void {
  if (typeof document === 'undefined') return;
  document.getElementById(BACKDROP_ID)?.remove();
}

export function captureIdleVisualBackdrop(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(BACKDROP_ID)) return;

  const app = document.getElementById('root');
  if (!app) return;

  const snapshot = app.cloneNode(true) as HTMLElement;
  snapshot.removeAttribute('id');
  snapshot.setAttribute('aria-hidden', 'true');
  snapshot.setAttribute('inert', '');

  // Exclude elements that might load external content, play audio/video,
  // display live sensitive form entries or be accidentally targeted by IDs.
  snapshot.querySelectorAll('iframe, video, audio, script, object, embed, canvas')
    .forEach(element => element.remove());
  snapshot.querySelectorAll('[id]').forEach(element => element.removeAttribute('id'));
  // Avoid any new remote image/bandwidth requests from the frozen copy.
  snapshot.querySelectorAll<HTMLImageElement>('img').forEach(image => {
    image.removeAttribute('srcset');
    image.removeAttribute('src');
    image.style.backgroundColor = 'rgba(148, 163, 184, .18)';
  });
  snapshot.querySelectorAll<HTMLSourceElement>('source').forEach(source => {
    source.removeAttribute('src');
    source.removeAttribute('srcset');
  });
  snapshot.querySelectorAll<HTMLInputElement>('input').forEach(input => {
    input.value = '';
    input.removeAttribute('value');
    input.checked = false;
    input.removeAttribute('checked');
  });
  snapshot.querySelectorAll<HTMLTextAreaElement>('textarea').forEach(textarea => {
    textarea.value = '';
    textarea.textContent = '';
  });
  snapshot.querySelectorAll<HTMLSelectElement>('select').forEach(select => {
    select.selectedIndex = -1;
  });
  snapshot.querySelectorAll<HTMLElement>('a,button,input,select,textarea,[tabindex]')
    .forEach(element => element.setAttribute('tabindex', '-1'));

  snapshot.style.width = '100%';
  snapshot.style.minHeight = '100vh';
  snapshot.style.pointerEvents = 'none';

  const backdrop = document.createElement('div');
  backdrop.id = BACKDROP_ID;
  backdrop.setAttribute('aria-hidden', 'true');
  backdrop.setAttribute('inert', '');
  backdrop.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:10', 'overflow:hidden',
    'pointer-events:none', 'user-select:none',
    'filter:blur(15px) saturate(.75)', 'transform:scale(1.025)',
    'transform-origin:center',
  ].join(';');
  backdrop.appendChild(snapshot);
  document.body.appendChild(backdrop);
}
