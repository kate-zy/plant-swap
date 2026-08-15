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
  const claimContactSelect = document.getElementById('claim-contact');
  const claimContactOther = document.getElementById('claim-contact-other');
  const toast = document.getElementById('toast');

  claimContactSelect.addEventListener('change', () => {
    const isOther = claimContactSelect.value === 'other';
    claimContactOther.style.display = isOther ? 'block' : 'none';
    if (isOther) claimContactOther.focus();
    claimContactSelect.classList.remove('invalid');
    document.getElementById('err-claim-contact').classList.remove('visible');
  });

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
      badge.textContent = p.remaining > 0 ? `${p.remaining} of ${p.quantity} available` : 'Fully claimed';
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

  const claimNameInput = document.getElementById('claim-name');
  const errName = document.getElementById('err-claim-name');
  const errContact = document.getElementById('err-claim-contact');
  const errQty = document.getElementById('err-claim-qty');

  function setFieldError(inputEl, errEl, msg) {
    inputEl.classList.add('invalid');
    errEl.textContent = msg;
    errEl.classList.add('visible');
  }

  function clearFieldError(inputEl, errEl) {
    inputEl.classList.remove('invalid');
    errEl.textContent = '';
    errEl.classList.remove('visible');
  }

  function clearAllErrors() {
    clearFieldError(claimNameInput, errName);
    clearFieldError(claimContactSelect, errContact);
    clearFieldError(claimQtyInput, errQty);
  }

  // Clear each field's error as soon as the person fixes it — no need to
  // wait for another submit attempt.
  claimNameInput.addEventListener('input', () => clearFieldError(claimNameInput, errName));
  claimContactSelect.addEventListener('input', () => clearFieldError(claimContactSelect, errContact));
  claimContactOther.addEventListener('input', () => clearFieldError(claimContactSelect, errContact));
  claimQtyInput.addEventListener('input', () => clearFieldError(claimQtyInput, errQty));

  function openClaimModal(plant) {
    claimTarget = plant;
    claimPlantName.textContent = `${plant.name} — ${plant.remaining} available`;
    claimForm.reset();
    claimQtyInput.value = 1;
    claimQtyInput.max = plant.remaining;
    claimContactOther.style.display = 'none';
    clearAllErrors();
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

    const name = claimNameInput.value.trim();
    const contact = claimContactSelect.value === 'other'
      ? claimContactOther.value.trim()
      : claimContactSelect.value;
    const qty = parseInt(claimQtyInput.value, 10);

    clearAllErrors();
    let firstInvalid = null;

    if (!name) {
      setFieldError(claimNameInput, errName, 'Please enter your name.');
      firstInvalid = firstInvalid || claimNameInput;
    }
    if (!contact) {
      setFieldError(
        claimContactSelect,
        errContact,
        claimContactSelect.value === 'other' ? 'Let us know how to reach you.' : 'Please choose an option.'
      );
      firstInvalid = firstInvalid || claimContactSelect;
    }
    if (!Number.isFinite(qty) || qty < 1) {
      setFieldError(claimQtyInput, errQty, 'Enter at least 1.');
      firstInvalid = firstInvalid || claimQtyInput;
    } else if (qty > claimTarget.remaining) {
      setFieldError(claimQtyInput, errQty, `Only ${claimTarget.remaining} left — lower the amount.`);
      firstInvalid = firstInvalid || claimQtyInput;
    }

    if (firstInvalid) {
      firstInvalid.focus();
      return;
    }

    const message = document.getElementById('claim-message').value.trim();
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
