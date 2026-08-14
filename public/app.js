(function () {
  const grid = document.getElementById('grid');
  const empty = document.getElementById('empty');
  const filters = document.getElementById('filters');
  const formFilters = document.getElementById('form-filters');
  const viewToggle = document.getElementById('view-toggle');
  const modal = document.getElementById('claim-modal');
  const claimForm = document.getElementById('claim-form');
  const claimPlantName = document.getElementById('claim-plant-name');
  const claimQtyInput = document.getElementById('claim-qty');
  const toast = document.getElementById('toast');

  const FORM_LABELS = {
    fresh_prop: 'Fresh prop',
    bare_root: 'Bare root',
    in_soil: 'In soil'
  };

  function getStoredView() {
    try {
      return localStorage.getItem('plantSwapView') === 'list' ? 'list' : 'grid';
    } catch (e) {
      return 'grid';
    }
  }

  let plants = [];
  let currentFilter = 'available'; // 'available' | 'all'
  let currentForm = 'all'; // 'all' | one of FORM_LABELS keys
  let currentView = getStoredView(); // 'grid' | 'list'
  let claimTarget = null;

  function showToast(msg) {
    toast.textContent = msg;
    toast.style.display = 'block';
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => (toast.style.display = 'none'), 3000);
  }

  function render() {
    const visible = plants.filter((p) => {
      if (currentFilter === 'available' && p.remaining <= 0) return false;
      if (currentForm !== 'all' && p.form !== currentForm) return false;
      return true;
    });
    grid.classList.toggle('list-view', currentView === 'list');
    grid.innerHTML = '';
    empty.style.display = visible.length ? 'none' : 'block';

    visible.forEach((p) => {
      const card = document.createElement('div');
      card.className = 'card';

      const photo = document.createElement('div');
      photo.className = 'photo' + (p.photo ? '' : ' placeholder');
      if (p.photo) photo.style.backgroundImage = `url('${p.photo}')`;
      card.appendChild(photo);

      const body = document.createElement('div');
      body.className = 'body';

      const details = document.createElement('div');
      details.className = 'details';

      const badgeRow = document.createElement('div');
      badgeRow.style.display = 'flex';
      badgeRow.style.gap = '6px';
      badgeRow.style.flexWrap = 'wrap';

      const badge = document.createElement('span');
      badge.className = `badge ${p.remaining > 0 ? 'available' : 'claimed'}`;
      badge.textContent = p.remaining > 0 ? `${p.remaining} available` : 'Fully claimed';
      badgeRow.appendChild(badge);

      const formBadge = document.createElement('span');
      formBadge.className = 'badge form-badge';
      formBadge.textContent = FORM_LABELS[p.form] || p.form;
      badgeRow.appendChild(formBadge);

      details.appendChild(badgeRow);

      const h3 = document.createElement('h3');
      h3.textContent = p.name;
      details.appendChild(h3);

      const meta = document.createElement('div');
      meta.className = 'meta';
      meta.textContent = `Qty listed: ${p.quantity}`;
      details.appendChild(meta);

      if (p.notes) {
        const notes = document.createElement('div');
        notes.className = 'notes';
        notes.textContent = p.notes;
        details.appendChild(notes);
      }

      body.appendChild(details);

      const spacer = document.createElement('div');
      spacer.className = 'spacer';
      body.appendChild(spacer);

      const claimBtn = document.createElement('button');
      claimBtn.className = 'btn-primary';
      if (p.remaining > 0) {
        claimBtn.textContent = 'Claim this';
        claimBtn.addEventListener('click', () => openClaimModal(p));
      } else {
        claimBtn.textContent = 'Fully claimed';
        claimBtn.disabled = true;
      }
      body.appendChild(claimBtn);

      card.appendChild(body);
      grid.appendChild(card);
    });
  }

  function openClaimModal(plant) {
    claimTarget = plant;
    claimPlantName.textContent = `${plant.name} — ${plant.remaining} available`;
    claimForm.reset();
    claimQtyInput.value = 1;
    claimQtyInput.max = plant.remaining;
    modal.style.display = 'flex';
  }

  function closeClaimModal() {
    modal.style.display = 'none';
    claimTarget = null;
  }

  document.getElementById('claim-cancel').addEventListener('click', closeClaimModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeClaimModal();
  });

  claimForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!claimTarget) return;
    const name = document.getElementById('claim-name').value.trim();
    const contact = document.getElementById('claim-contact').value.trim();
    const message = document.getElementById('claim-message').value.trim();
    const qty = Math.max(1, parseInt(claimQtyInput.value, 10) || 1);
    try {
      const res = await fetch(`/api/plants/${claimTarget.id}/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, contact, message, qty })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Something went wrong');
      showToast('Claim sent! The owner will follow up with you.');
      closeClaimModal();
      await load();
    } catch (err) {
      showToast(err.message);
    }
  });

  filters.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-filter]');
    if (!btn) return;
    currentFilter = btn.dataset.filter;
    [...filters.querySelectorAll('button')].forEach((b) => b.classList.toggle('active', b === btn));
    render();
  });

  formFilters.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-form]');
    if (!btn) return;
    currentForm = btn.dataset.form;
    [...formFilters.querySelectorAll('button')].forEach((b) => b.classList.toggle('active', b === btn));
    render();
  });

  viewToggle.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-view]');
    if (!btn) return;
    currentView = btn.dataset.view;
    [...viewToggle.querySelectorAll('button')].forEach((b) => b.classList.toggle('active', b === btn));
    try {
      localStorage.setItem('plantSwapView', currentView);
    } catch (e) {}
    render();
  });

  async function load() {
    const res = await fetch('/api/plants');
    plants = await res.json();
    render();
  }

  async function loadConfig() {
    try {
      const res = await fetch('/api/config');
      const cfg = await res.json();
      if (cfg.siteName) document.getElementById('site-title').textContent = `🌿 ${cfg.siteName} 🌿`;
      if (cfg.siteName) document.title = cfg.siteName;
    } catch (e) {}
  }

  [...viewToggle.querySelectorAll('button')].forEach((b) =>
    b.classList.toggle('active', b.dataset.view === currentView)
  );

  loadConfig();
  load();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
  }
})();
