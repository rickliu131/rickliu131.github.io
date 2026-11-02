const image = document.querySelector('[data-animation]');
if (image) {
  const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
  function updateMotion() {
    image.src = preference.matches ? image.dataset.poster : image.dataset.animation;
    image.closest('a').href = image.src;
  }
  updateMotion();
  preference.addEventListener('change', updateMotion);
}
