// Vanilla client JS for the Cat Ranking UI. Served at /ui.js.
// Behaviors: modal open/close, sidebar toggle, edge-swipe.

const modal = document.getElementById('modal');
const sidebar = document.getElementById('sidebar');
const backdrop = document.getElementById('sidebar-backdrop');
const toggle = document.getElementById('sidebar-toggle');

// 1. Open the dialog after HTMX swaps a fragment into #modal-body.
document.body.addEventListener('htmx:afterSwap', (event) => {
  if (event.target.id === 'modal-body') {
    modal.showModal();
  }
});

// 2. Close the dialog: backdrop click or any [data-close-modal] element.
modal.addEventListener('click', (event) => {
  if (event.target === modal) {
    modal.close();
  }
});
document.body.addEventListener('click', (event) => {
  if (event.target.closest('[data-close-modal]')) {
    modal.close();
  }
});

// 3. Sidebar toggle (☰) and backdrop click.
function setSidebar(open) {
  sidebar.classList.toggle('open', open);
  backdrop.classList.toggle('show', open);
}
toggle.addEventListener('click', () => {
  setSidebar(!sidebar.classList.contains('open'));
});
backdrop.addEventListener('click', () => setSidebar(false));

// 4. Edge-swipe: left from the right edge opens, right closes.
let startX = 0;
let startY = 0;
let curX = 0;
let curY = 0;
let fromEdge = false;

document.addEventListener(
  'touchstart',
  (event) => {
    const touch = event.touches[0];
    startX = curX = touch.clientX;
    startY = curY = touch.clientY;
    fromEdge = window.innerWidth - touch.clientX <= 20;
  },
  { passive: true },
);

document.addEventListener(
  'touchmove',
  (event) => {
    const touch = event.touches[0];
    curX = touch.clientX;
    curY = touch.clientY;
  },
  { passive: true },
);

document.addEventListener(
  'touchend',
  () => {
    const dx = curX - startX;
    const dy = curY - startY;
    if (Math.abs(dx) < 40 || Math.abs(dy) > Math.abs(dx)) {
      return;
    }
    if (fromEdge && dx < 0) {
      setSidebar(true);
    } else if (sidebar.classList.contains('open') && dx > 0) {
      setSidebar(false);
    }
  },
  { passive: true },
);
