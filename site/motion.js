const image = document.querySelector('[data-animation]');
const toggle = document.querySelector('.motion-toggle');
if (image && toggle) {
  const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
  let playing = false;
  function setPlaying(value) {
    playing = value;
    image.src = playing ? image.dataset.animation : image.dataset.poster;
    image.closest('a').href = image.src;
    const action = playing ? 'Pause animation' : 'Play animation';
    toggle.dataset.playing = String(playing);
    toggle.setAttribute('aria-label', `${action} for WorldScribe`);
    toggle.title = action;
  }
  toggle.hidden = false;
  setPlaying(!preference.matches);
  toggle.addEventListener('click', () => setPlaying(!playing));
  preference.addEventListener('change', () => setPlaying(!preference.matches));
}
