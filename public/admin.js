(function () {
  const addForm = document.getElementById('add-form');
  const photoInput = document.getElementById('f-photo');
  const photoPreview = document.getElementById('f-photo-preview');
  const adminList = document.getElementById('admin-list');
  const adminEmpty = document.getElementById('admin-empty');
  const toast = document.getElementById('toast');
  const notifyEnableBtn = document.getElementById('notify-enable');
  const notifyTestBtn = document.getElementById('notify-test');
  const notifyStatus = document.getElementById('notify-status');

  const editModal = document.getElementById('edit-modal');
  const editForm = document.getElementById('edit-form');
  const editCancelBtn = document.getElementById('edit-cancel');
  const eName = document.getElementById('e-name');
  const eForm = document.getElementById('e-form');
  const eQty = document.getElementById('e-qty');
  const eQtyHint = document.getElementById('e-qty-hint');
  const eNotes = document.getElementById('e-notes');
  const ePhotoInput = document.getElementById('e-photo');
  const ePhotoPreview = document.getElementById('e-photo-preview');

  const FORM_LABELS = {
    fresh_prop: 'Fresh prop',
    bare_root: 'Bare root',
    in_soil: 'In soil'
  };

  let pendingPhotoDataUrl = null;

  function showToast(msg) {
    toast.textContent = msg;
    toast.style.display = 'block';
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => (toast.style.display = 'none'), 3000);
  }

  photoInput.addEventListener('change', () => {
    const file = photoInput.files[0];
    if (!file) {
      pendingPhotoDataUrl = null;
      photoPreview.style.display = 'none';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      pendingPhotoDataUrl = reader.result;
      photoPreview.style.backgroundImage = `url('${reader.result}')`;
      photoPreview.style.display = 'block';
    };
    reader.readAsDataURL(file);
  });

  addForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('f-name').value.trim();
    const form = document.getElementById('f-form').value;
    const quantity = document.getElementById('f-qty').value;
    const notes = document.getElementById('f-notes').value.trim();
    try {
      const res = await fetch('/api/plants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, form, quantity, notes, photoDataUrl: pendingPhotoDataUrl })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not add listing');
      showToast('Listing added!');
      addForm.reset();
      pendingPhotoDataUrl = null;
      photoPreview.style.display = 'none';
      await load();
    } catch (err) {
      showToast(err.message);
    }
  });

  function renderRow(p) {
    const row = document.createElement('div');
    row.className = 'admin-row';

    const topLine = document.createElement('div');
    topLine.className = 'top-line';

    const thumb = document.createElement('div');
    thumb.className = 'thumb';
    if (p.photo) thumb.style.backgroundImage = `url('${p.photo}')`;
    topLine.appendChild(thumb);

    const info = document.createElement('div');
    info.className = 'info';
    const h4 = document.createElement('h4');
    h4.textContent = p.name;
    info.appendChild(h4);
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = `${FORM_LABELS[p.form] || p.form} · ${p.remaining} of ${p.quantity} available`;
    info.appendChild(meta);
    topLine.appendChild(info);

    const actions = document.createElement('div');
    actions.className = 'actions';
    const editBtn = document.createElement('button');
    editBtn.className = 'btn-outline';
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', () => openEditModal(p));
    actions.appendChild(editBtn);
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn-danger';
    deleteBtn.textContent = 'Delete listing';
    deleteBtn.addEventListener('click', () => remove(p.id, p.name));
    actions.appendChild(deleteBtn);
    topLine.appendChild(actions);

    row.appendChild(topLine);

    const pendingOrConfirmed = (p.claims || []).filter((c) => c.status === 'requested' || c.status === 'confirmed');
    if (pendingOrConfirmed.length) {
      const claimsList = document.createElement('div');
      claimsList.className = 'claims-list';
      pendingOrConfirmed.forEach((c) => claimsList.appendChild(renderClaimRow(p, c)));
      row.appendChild(claimsList);
    }

    return row;
  }

  function renderClaimRow(plant, claim) {
    const cRow = document.createElement('div');
    cRow.className = 'claim-row';

    const infoEl = document.createElement('div');
    infoEl.className = 'claim-info';
    infoEl.innerHTML = `<span class="who">${escapeHtml(claim.name)}</span> — ${escapeHtml(claim.contact)} ` +
      `<span class="qty">(${claim.qty} ${claim.qty === 1 ? 'unit' : 'units'}${claim.status === 'confirmed' ? ', confirmed' : ', pending'})</span>` +
      (claim.message ? `<br><em>"${escapeHtml(claim.message)}"</em>` : '');
    cRow.appendChild(infoEl);

    const actions = document.createElement('div');
    actions.className = 'actions';

    if (claim.status === 'requested') {
      const confirmBtn = document.createElement('button');
      confirmBtn.className = 'btn-secondary';
      confirmBtn.textContent = 'Confirm picked up';
      confirmBtn.addEventListener('click', () => claimAction(plant.id, claim.id, 'confirm'));
      actions.appendChild(confirmBtn);
    }

    const rejectBtn = document.createElement('button');
    rejectBtn.className = 'btn-outline';
    rejectBtn.textContent = claim.status === 'confirmed' ? 'Undo' : 'Reject';
    rejectBtn.addEventListener('click', () => claimAction(plant.id, claim.id, 'reject'));
    actions.appendChild(rejectBtn);

    cRow.appendChild(actions);
    return cRow;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  async function claimAction(plantId, claimId, action) {
    try {
      const res = await fetch(`/api/plants/${plantId}/claims/${claimId}/${action}`, { method: 'POST' });
      if (!res.ok) throw new Error((await res.json()).error || 'Action failed');
      await load();
    } catch (err) {
      showToast(err.message);
    }
  }

  async function remove(id, name) {
    if (!confirm(`Delete "${name}"? This can't be undone.`)) return;
    try {
      const res = await fetch(`/api/plants/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.json()).error || 'Delete failed');
      showToast('Listing deleted');
      await load();
    } catch (err) {
      showToast(err.message);
    }
  }

  async function load() {
    const res = await fetch('/api/plants');
    const plants = await res.json();
    plants.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    adminList.innerHTML = '';
    adminEmpty.style.display = plants.length ? 'none' : 'block';
    plants.forEach((p) => adminList.appendChild(renderRow(p)));
  }

  // --- Edit listing ---
  let editTargetId = null;
  let pendingEditPhotoDataUrl = null;

  function openEditModal(plant) {
    editTargetId = plant.id;
    pendingEditPhotoDataUrl = null;
    eName.value = plant.name;
    eForm.value = plant.form;
    eQty.value = plant.quantity;
    eNotes.value = plant.notes || '';
    ePhotoInput.value = '';

    if (plant.photo) {
      ePhotoPreview.style.backgroundImage = `url('${plant.photo}')`;
      ePhotoPreview.style.display = 'block';
    } else {
      ePhotoPreview.style.display = 'none';
    }

    const reserved = plant.quantity - plant.remaining;
    if (reserved > 0) {
      eQty.min = reserved;
      eQtyHint.textContent = `${reserved} already spoken for (pending or confirmed) — can't go below that.`;
    } else {
      eQty.min = 1;
      eQtyHint.textContent = '';
    }

    editModal.style.display = 'flex';
  }

  function closeEditModal() {
    editModal.style.display = 'none';
    editTargetId = null;
  }

  editCancelBtn.addEventListener('click', closeEditModal);
  editModal.addEventListener('click', (e) => {
    if (e.target === editModal) closeEditModal();
  });

  ePhotoInput.addEventListener('change', () => {
    const file = ePhotoInput.files[0];
    if (!file) {
      pendingEditPhotoDataUrl = null;
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      pendingEditPhotoDataUrl = reader.result;
      ePhotoPreview.style.backgroundImage = `url('${reader.result}')`;
      ePhotoPreview.style.display = 'block';
    };
    reader.readAsDataURL(file);
  });

  editForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!editTargetId) return;
    const body = {
      name: eName.value.trim(),
      form: eForm.value,
      quantity: eQty.value,
      notes: eNotes.value.trim()
    };
    if (pendingEditPhotoDataUrl) body.photoDataUrl = pendingEditPhotoDataUrl;
    try {
      const res = await fetch(`/api/plants/${editTargetId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save changes');
      showToast('Listing updated!');
      closeEditModal();
      await load();
    } catch (err) {
      showToast(err.message);
    }
  });

  load();

  // --- Push notifications ---
  function urlBase64ToUint8Array(base64url) {
    const padding = '='.repeat((4 - (base64url.length % 4)) % 4);
    const base64 = (base64url + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
  }

  function setNotifyUI(state, message) {
    if (state === 'enabled') {
      notifyEnableBtn.style.display = 'none';
      notifyTestBtn.style.display = 'block';
    } else {
      notifyEnableBtn.style.display = 'block';
      notifyTestBtn.style.display = 'none';
    }
    notifyStatus.textContent = message || '';
  }

  async function initNotifications() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setNotifyUI('disabled', 'Push notifications aren’t supported in this browser. On iPhone, add this site to your Home Screen first (Safari share menu), then open it from there.');
      notifyEnableBtn.disabled = true;
      return;
    }
    try {
      const registration = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      if (existing) {
        setNotifyUI('enabled', 'Push notifications are on for this device.');
      } else if (Notification.permission === 'denied') {
        setNotifyUI('disabled', 'Notifications are blocked for this site in your browser settings.');
      } else {
        setNotifyUI('disabled', '');
      }
    } catch (e) {
      setNotifyUI('disabled', 'Could not set up notifications: ' + e.message);
    }
  }

  notifyEnableBtn.addEventListener('click', async () => {
    notifyEnableBtn.disabled = true;
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setNotifyUI('disabled', 'Notification permission was not granted.');
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const keyRes = await fetch('/api/push/vapid-public-key');
      const { publicKey } = await keyRes.json();
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey)
      });
      const res = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(subscription.toJSON())
      });
      if (!res.ok) throw new Error('Server rejected the subscription');
      setNotifyUI('enabled', 'Push notifications are on for this device.');
      showToast('Notifications enabled!');
    } catch (e) {
      setNotifyUI('disabled', 'Could not enable notifications: ' + e.message);
    } finally {
      notifyEnableBtn.disabled = false;
    }
  });

  notifyTestBtn.addEventListener('click', async () => {
    try {
      const res = await fetch('/api/push/test', { method: 'POST' });
      if (!res.ok) throw new Error('Test send failed');
      showToast('Test notification sent — check this device.');
    } catch (e) {
      showToast(e.message);
    }
  });

  initNotifications();
})();
