const grid = document.getElementById('game-inventory');
const toggle = document.getElementById('toggle-games');
const state = document.getElementById('inventory-state');
const heading = document.getElementById('inventory-title');
let games = [];
let expanded = false;
let loading = null;

function gameCard(game) {
  const item = document.createElement('li');
  item.className = 'game-card';
  const figure = document.createElement('figure');
  const cover = document.createElement('div');
  cover.className = 'game-cover';
  cover.setAttribute('aria-hidden', 'true');
  {
    const image = document.createElement('img');
    image.src = game.cover;
    image.alt = '';
    image.width = 300;
    image.height = 450;
    image.loading = 'lazy';
    image.decoding = 'async';
    image.addEventListener('error', () => {
      image.remove();
      cover.classList.add('cover-unavailable');
      cover.textContent = game.title;
    }, {once: true});
    cover.append(image);
  }
  const caption = document.createElement('figcaption');
  caption.textContent = game.title;
  figure.append(cover, caption);
  item.append(figure);
  return item;
}

function render() {
  const visible = expanded ? games : games.filter(game => Number.isInteger(game.previewOrder))
    .sort((a, b) => a.previewOrder - b.previewOrder);
  grid.replaceChildren(...visible.map(gameCard));
  grid.setAttribute('aria-busy', 'false');
  toggle.hidden = games.length <= visible.length && !expanded;
  toggle.setAttribute('aria-expanded', String(expanded));
  toggle.textContent = expanded ? 'Show less' : 'Show more';
  state.className = 'sr-only';
  state.textContent = `Showing ${visible.length} of ${games.length} selected games.`;
}

toggle.addEventListener('click', () => {
  const headingAboveViewport = heading.getBoundingClientRect().top < 0;
  expanded = !expanded;
  render();
  if (headingAboveViewport) heading.scrollIntoView({block: 'start'});
});

export function showGameInventory() {
  if (loading) return loading;
  loading = (async () => {
    try {
      const response = await fetch('./games.json?v=20261117-six-games');
      if (!response.ok) throw new Error('Inventory unavailable');
      const data = await response.json();
      if (!Array.isArray(data.games) || !data.games.length) throw new Error('Inventory empty');
      games = data.games;
      render();
    } catch {
      grid.setAttribute('aria-busy', 'false');
      state.className = 'inventory-state';
      state.textContent = 'The game collection could not be loaded. Please reload the page.';
      loading = null;
    }
  })();
  return loading;
}
