const image = document.querySelector('[data-animation]');
const toggle = document.querySelector('.motion-toggle');
if (image && toggle) {
  const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
  let playing = false;
  function setPlaying(value) {
    playing = value;
    image.src = playing ? image.dataset.animation : image.dataset.poster;
    image.closest('a').href = image.src;
    toggle.textContent = playing ? 'Pause animation' : 'Play animation';
    toggle.setAttribute('aria-label', `${toggle.textContent} for WorldScribe`);
  }
  toggle.hidden = false;
  setPlaying(!preference.matches);
  toggle.addEventListener('click', () => setPlaying(!playing));
  preference.addEventListener('change', () => setPlaying(!preference.matches));
}
