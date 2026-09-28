export const slotTemplate = `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Appointment Slots Picker</title>
    <style>
      :root {
        --bg: #0f1724;
        --card: #0b1220;
        --muted: #94a3b8;
        --accent: #06b6d4;
        --success: #16a34a;
        --danger: #ef4444;
        --warning: #f59e0b;
        --pill-padding: 8px 12px;
        --radius: 10px;
        color-scheme: light;
        font-family:
          Inter,
          system-ui,
          -apple-system,
          'Segoe UI',
          Roboto,
          'Helvetica Neue',
          Arial;
      }
      * {
        box-sizing: border-box;
      }
      body {
        margin: 0;
        background: #f6f8fb;
        color: #0b1220;
        line-height: 1.3;
      }
      .app {
        max-width: 1100px;
        margin: 24px auto;
        padding: 16px;
        gap: 16px;
        display: grid;
        grid-template-columns: 280px 1fr 320px;
      }
      .card {
        background: #fff;
        border-radius: 12px;
        padding: 14px;
        box-shadow: 0 6px 18px rgba(16, 24, 40, 0.06);
      }
      .day-list {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .mini-calendar {
        display: flex;
        gap: 8px;
        overflow: auto;
        padding-bottom: 8px;
      }
      .day-btn {
        min-width: 72px;
        padding: 10px;
        border-radius: 8px;
        border: 1px solid #e6eef8;
        background: transparent;
        cursor: pointer;
        text-align: center;
      }
      .day-btn.selected {
        background: linear-gradient(90deg, #ecfeff, #f0f9ff);
        border-color: transparent;
        box-shadow: 0 2px 6px rgba(6, 182, 212, 0.12);
      }
      .day-label {
        font-weight: 600;
        font-size: 14px;
      }
      .day-sub {
        font-size: 12px;
        color: var(--muted);
        margin-top: 4px;
      }
      .timeline {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .time-grid {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }
      .slot {
        padding: var(--pill-padding);
        border-radius: 999px;
        border: 1px solid #e6eef8;
        background: #fff;
        cursor: pointer;
        min-width: 120px;
        text-align: center;
        user-select: none;
      }
      .slot.available {
        background: #f0fdf4;
        border-color: #dcfce7;
        color: var(--success);
      }
      .slot.booked {
        background: #fff5f5;
        border-color: #fee2e2;
        color: var(--danger);
        opacity: 0.9;
        cursor: not-allowed;
      }
      .slot.break {
        background: #f8fafc;
        border-color: #e6eef8;
        color: var(--muted);
        cursor: not-allowed;
      }
      .slot.reserved {
        background: #fff7ed;
        border-color: #fde68a;
        color: var(--warning);
      }
      .slot.selected {
        outline: 3px solid rgba(6, 182, 212, 0.12);
      }
      .right-panel .summary {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .btn {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 10px 14px;
        border-radius: 8px;
        border: 0;
        cursor: pointer;
      }
      .btn.primary {
        background: var(--accent);
        color: #fff;
      }
      .btn.ghost {
        background: transparent;
        border: 1px solid #e6eef8;
      }
      .muted {
        color: var(--muted);
        font-size: 13px;
      }
      .small {
        font-size: 13px;
      }
      .slot-meta {
        display: flex;
        gap: 8px;
        align-items: center;
        justify-content: center;
      }
      .pill {
        padding: 6px 8px;
        border-radius: 999px;
        font-size: 12px;
        border: 1px solid #eee;
      }
      /* responsive */
      @media (max-width: 980px) {
        .app {
          grid-template-columns: 1fr;
          padding: 12px;
        }
        .right-panel {
          order: 3;
        }
        .mini-calendar {
          justify-content: flex-start;
        }
      }
      /* simple modal */
      .modal-back {
        position: fixed;
        inset: 0;
        display: none;
        align-items: center;
        justify-content: center;
        background: rgba(2, 6, 23, 0.5);
        z-index: 60;
      }
      .modal {
        background: #fff;
        padding: 18px;
        border-radius: 12px;
        max-width: 560px;
        width: 92%;
        box-shadow: 0 10px 40px rgba(2, 6, 23, 0.2);
      }
      .show {
        display: flex;
      }
    </style>
  </head>
  <body>
    <div class="app" id="app">
      <!-- Left: Date selector -->
      <div class="card">
        <h3 style="margin: 0 0 12px 0">Pick a day</h3>
        <div class="day-list">
          <div
            class="mini-calendar"
            id="dayList"
            aria-label="Available dates"
            role="listbox"
          ></div>
          <div class="muted small">
            Tip: choose a date to view slots. Mobile friendly.
          </div>
        </div>
      </div>

      <!-- Center: Timeline / slots -->
      <div class="card">
        <div
          style="
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 8px;
          "
        >
          <div>
            <h3 id="dayTitle" style="margin: 0">
              Slots for <span id="dayLabel">—</span>
            </h3>
            <div class="muted small" id="clinicInfo">Clinic: Demo Clinic</div>
          </div>
          <div>
            <button class="btn ghost" id="refreshBtn">Refresh</button>
          </div>
        </div>

        <div class="timeline" id="timeline">
          <div class="muted small" id="timelineHint">Loading slots…</div>
          <div class="time-grid" id="slotsGrid" role="list"></div>
        </div>
      </div>

      <!-- Right: Selected slot summary -->
      <div class="card right-panel">
        <h3 style="margin: 0 0 12px 0">Selected slot</h3>
        <div class="summary" id="selectedSummary">
          <div class="muted">No slot selected</div>
          <div style="display: flex; gap: 8px; margin-top: 8px">
            <button class="btn primary" id="confirmBtn" disabled>
              Reserve
            </button>
            <button class="btn ghost" id="clearBtn" disabled>Clear</button>
          </div>
          <div style="margin-top: 12px" id="reservationInfo"></div>
        </div>
        <hr
          style="margin: 16px 0; border: none; border-top: 1px solid #f1f7fb"
        />
        <div>
          <h4 style="margin: 0 0 8px 0">Legend</h4>
          <div style="display: flex; gap: 8px; flex-wrap: wrap">
            <div class="pill">Available</div>
            <div
              class="pill"
              style="background: #fff7ed; border: 1px solid #fde68a"
            >
              Reserved
            </div>
            <div
              class="pill"
              style="background: #fff5f5; border: 1px solid #fee2e2"
            >
              Booked
            </div>
            <div
              class="pill"
              style="
                background: #f8fafc;
                border: 1px solid #e6eef8;
                color: #94a3b8;
              "
            >
              Break
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Modal -->
    <div
      id="modal"
      class="modal-back"
      role="dialog"
      aria-modal="true"
      aria-hidden="true"
    >
      <div class="modal" id="modalCard" role="document">
        <h3 id="modalTitle">Confirm reservation</h3>
        <div id="modalBody" style="margin-top: 8px"></div>
        <div
          style="
            display: flex;
            gap: 8px;
            justify-content: flex-end;
            margin-top: 12px;
          "
        >
          <button class="btn ghost" id="modalCancel">Cancel</button>
          <button class="btn primary" id="modalConfirm">Reserve</button>
        </div>
      </div>
    </div>

    <script>
      // ------- Mock API and state (replace with your real endpoints) -------
      // Sample clinic working hours and breaks will be generated on the fly
      const MOCK_SLOT_MINUTES = 30;
      const RESERVATION_TTL_MS = 5 * 60 * 1000; // 5 minutes

      // In-memory simulation of server state
      const server = {
        // key: dateStr (YYYY-MM-DD) => array of slots (id, start, end, state)
        slotsByDate: {},
        reservations: {}, // reservationId -> {slotId, expiresAt}
      };

      // utility: format Date -> YYYY-MM-DD
      function toDateStr(d) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return \`\${y}-\${m}-\${dd}\`;
      }

      // generate slots for demo: from 09:00 to 17:00, with one break
      function generateDemoSlots(dateStr) {
        if (server.slotsByDate[dateStr]) return server.slotsByDate[dateStr];
        const dayStart = 9 * 60;
        const dayEnd = 17 * 60;
        const slots = [];
        let idCounter = 1;
        for (
          let s = dayStart;
          s + MOCK_SLOT_MINUTES <= dayEnd;
          s += MOCK_SLOT_MINUTES
        ) {
          const hh = String(Math.floor(s / 60)).padStart(2, '0');
          const mm = String(s % 60).padStart(2, '0');
          const start = \`\${hh}:\${mm}\`;
          const e = s + MOCK_SLOT_MINUTES;
          const eh = String(Math.floor(e / 60)).padStart(2, '0');
          const em = String(e % 60).padStart(2, '0');
          const end = \`\${eh}:\${em}\`;
          slots.push({
            id: \`\${dateStr}-\${idCounter++}\`,
            start,
            end,
            state: 'available', // available | booked | break | reserved
          });
        }
        // put a break at 13:00-14:00
        const breakIndex = slots.findIndex((s) => s.start === '13:00');
        if (breakIndex >= 0) {
          slots[breakIndex].state = 'break';
        }
        // add a pre-booked slot for demo
        const bookedIndex = slots.findIndex((s) => s.start === '10:00');
        if (bookedIndex >= 0) slots[bookedIndex].state = 'booked';
        server.slotsByDate[dateStr] = slots;
        return slots;
      }

      // mock fetch slots
      async function fetchSlots(dateStr) {
        await delay(300); // simulate network
        return JSON.parse(JSON.stringify(generateDemoSlots(dateStr)));
      }

      // mock reserve slot on server (optimistic style: server single source)
      async function reserveSlotOnServer(slotId) {
        // find the slot
        for (const date in server.slotsByDate) {
          const arr = server.slotsByDate[date];
          const slot = arr.find((s) => s.id === slotId);
          if (!slot) continue;
          if (slot.state !== 'available') {
            return { ok: false, reason: 'Not available' };
          }
          // mark reserved
          slot.state = 'reserved';
          const reservationId = \`r-\${Math.random().toString(36).slice(2, 9)}\`;
          const expiresAt = Date.now() + RESERVATION_TTL_MS;
          server.reservations[reservationId] = { slotId, expiresAt };
          // schedule expiry
          setTimeout(() => {
            // expire reservation if still reserved
            const entry = server.reservations[reservationId];
            if (entry && Date.now() >= entry.expiresAt) {
              // find slot and free it
              for (const d in server.slotsByDate) {
                const s = server.slotsByDate[d].find(
                  (x) => x.id === entry.slotId
                );
                if (s && s.state === 'reserved') s.state = 'available';
              }
              delete server.reservations[reservationId];
              // trigger UI refresh globally if implemented
              renderSlots(currentDateStr); // keep simple demo
            }
          }, RESERVATION_TTL_MS + 500);
          return { ok: true, reservationId, expiresAt };
        }
        return { ok: false, reason: 'Not found' };
      }

      async function delay(ms) {
        return new Promise((res) => setTimeout(res, ms));
      }

      // ------- UI logic -------
      const dayListEl = document.getElementById('dayList');
      const dayLabelEl = document.getElementById('dayLabel');
      const slotsGrid = document.getElementById('slotsGrid');
      const timelineHint = document.getElementById('timelineHint');
      const refreshBtn = document.getElementById('refreshBtn');
      const confirmBtn = document.getElementById('confirmBtn');
      const clearBtn = document.getElementById('clearBtn');
      const reservationInfo = document.getElementById('reservationInfo');
      const modal = document.getElementById('modal');
      const modalBody = document.getElementById('modalBody');
      const modalTitle = document.getElementById('modalTitle');
      const modalCancel = document.getElementById('modalCancel');
      const modalConfirm = document.getElementById('modalConfirm');

      let currentDateStr = toDateStr(new Date());
      let days = []; // next 14 days
      let slotsState = []; // current slots
      let selectedSlot = null;
      let activeReservation = null; // {reservationId, expiresAt, slotId, timer}

      function buildDays() {
        days = [];
        const today = new Date();
        for (let i = 0; i < 14; i++) {
          const d = new Date(today.getTime() + i * 86400000);
          days.push({
            dateStr: toDateStr(d),
            label: d.toLocaleDateString(undefined, {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
            }),
          });
        }
      }

      function renderDays() {
        dayListEl.innerHTML = '';
        days.forEach((d) => {
          const btn = document.createElement('button');
          btn.className =
            'day-btn' + (d.dateStr === currentDateStr ? ' selected' : '');
          btn.setAttribute('role', 'option');
          btn.innerHTML = \`<div class="day-label">\${d.label.split(',')[0]}</div><div class="day-sub">\${d.label.split(',').slice(1).join(',')}</div>\`;
          btn.onclick = () => {
            changeDate(d.dateStr);
          };
          dayListEl.appendChild(btn);
        });
      }

      function isoToNice(dateStr, timeStr) {
        // dateStr YYYY-MM-DD, timeStr HH:MM
        return \`\${dateStr} \${timeStr}\`;
      }

      async function loadSlots(dateStr) {
        timelineHint.textContent = 'Loading slots…';
        slotsGrid.innerHTML = '';
        try {
          const arr = await fetchSlots(dateStr);
          slotsState = arr;
          renderSlots(dateStr);
        } catch (e) {
          console.error(e);
          timelineHint.textContent = 'Failed to load slots';
        }
      }

      function renderSlots(dateStr) {
        dayLabelEl.textContent = dateStr;
        timelineHint.textContent = '';
        slotsGrid.innerHTML = '';
        slotsState.forEach((slot) => {
          const btn = document.createElement('button');
          btn.className = 'slot ' + slot.state;
          btn.setAttribute('role', 'listitem');
          btn.innerHTML = \`<div style="font-weight:600">\${slot.start} - \${slot.end}</div>
                         <div class="slot-meta muted">\${slot.state === 'available' ? 'Available' : slot.state === 'booked' ? 'Booked' : slot.state === 'break' ? 'Break' : 'Reserved'}</div>\`;
          // click behavior
          if (slot.state === 'available') {
            btn.onclick = () => selectSlot(slot);
          } else {
            btn.onclick = () => {
              // show reason in modal if booked/break
              showModal(slot, false);
            };
          }
          // highlight selected
          if (selectedSlot && selectedSlot.id === slot.id)
            btn.classList.add('selected');
          slotsGrid.appendChild(btn);
        });
      }

      function selectSlot(slot) {
        selectedSlot = slot;
        updateSelectionUI();
      }

      function updateSelectionUI() {
        // repaint selection highlight
        const children = Array.from(slotsGrid.children);
        children.forEach((c, idx) => {
          c.classList.toggle(
            'selected',
            slotsState[idx] &&
              selectedSlot &&
              slotsState[idx].id === selectedSlot.id
          );
        });
        const summary = document.getElementById('selectedSummary');
        if (!selectedSlot) {
          summary.querySelector('.muted').textContent = 'No slot selected';
          confirmBtn.disabled = true;
          clearBtn.disabled = true;
          reservationInfo.innerHTML = '';
        } else {
          summary.querySelector('.muted').textContent =
            isoToNice(currentDateStr, selectedSlot.start) +
            ' — ' +
            selectedSlot.end;
          confirmBtn.disabled = selectedSlot.state !== 'available';
          clearBtn.disabled = false;
          // show small details
          reservationInfo.innerHTML = \`<div class="small">Status: <strong>\${selectedSlot.state}</strong></div>\`;
        }
      }

      function changeDate(dateStr) {
        currentDateStr = dateStr;
        // re-render days selected state
        renderDays();
        selectedSlot = null;
        updateSelectionUI();
        loadSlots(dateStr);
      }

      // modal helpers
      function showModal(slot, allowReserve = true) {
        modalTitle.textContent = allowReserve ? 'Reserve slot' : 'Slot details';
        modalBody.innerHTML = \`<div><strong>\${slot.start} - \${slot.end}</strong></div>
        <div class="muted small" style="margin-top:8px">Date: \${currentDateStr}</div>
        <div style="margin-top:8px" class="muted small">State: \${slot.state}</div>\`;
        modal.classList.add('show');
        modal.setAttribute('aria-hidden', 'false');
        modalConfirm.disabled = !allowReserve;
        // attach confirm action
        modalConfirm.onclick = async () => {
          await doReserve(slot);
          closeModal();
        };
      }
      function closeModal() {
        modal.classList.remove('show');
        modal.setAttribute('aria-hidden', 'true');
      }
      modalCancel.onclick = closeModal;

      // Reserve flow: optimistic + server call
      async function doReserve(slot) {
        // disable button
        confirmBtn.disabled = true;
        // show modal busy
        modalConfirm.textContent = 'Reserving…';
        const res = await reserveSlotOnServer(slot.id);
        modalConfirm.textContent = 'Reserve';
        if (!res.ok) {
          alert('Failed to reserve: ' + (res.reason || 'unknown'));
          // refresh to get real state
          await loadSlots(currentDateStr);
          return;
        }
        // success -> store active reservation locally and update UI
        const { reservationId, expiresAt } = res;
        activeReservation = { reservationId, slotId: slot.id, expiresAt };
        // update local copy of slotsState
        slotsState = slotsState.map((s) =>
          s.id === slot.id ? { ...s, state: 'reserved' } : s
        );
        renderSlots(currentDateStr);
        updateSelectionUI();

        // show reservation info and countdown
        startReservationCountdown();
      }

      function startReservationCountdown() {
        if (!activeReservation) return;
        // clear any previous timer
        if (activeReservation.timer) clearInterval(activeReservation.timer);
        const infoEl = reservationInfo;
        function update() {
          const ms = activeReservation.expiresAt - Date.now();
          if (ms <= 0) {
            // expired
            infoEl.innerHTML = \`<div class="muted small">Reservation expired</div>\`;
            activeReservation = null;
            // reload state
            loadSlots(currentDateStr);
            return;
          }
          const minutes = Math.floor(ms / 60000);
          const seconds = Math.floor((ms % 60000) / 1000);
          infoEl.innerHTML = \`<div>Reserved — expires in <strong>\${minutes}m \${String(seconds).padStart(2, '0')}s</strong></div>
          <div class="small muted">Complete your booking to confirm.</div>\`;
        }
        update();
        activeReservation.timer = setInterval(update, 1000);
      }

      // clear selection
      clearBtn.onclick = () => {
        selectedSlot = null;
        updateSelectionUI();
      };

      // confirm button opens modal
      confirmBtn.onclick = () => {
        if (!selectedSlot) return;
        showModal(selectedSlot, true);
      };

      // refresh
      refreshBtn.onclick = () => loadSlots(currentDateStr);

      // init page
      function init() {
        buildDays();
        renderDays();
        changeDate(currentDateStr);
      }

      // expose for debugging on window
      window.mockServer = server;

      init();
    </script>
  </body>
</html>
`;
