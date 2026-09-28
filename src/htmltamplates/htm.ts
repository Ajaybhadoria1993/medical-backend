export const htmTemplate = `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Socket.IO Notification Tester</title>
    <script src="https://cdn.socket.io/4.6.1/socket.io.min.js"></script>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
      /* small scrollbar for log/panel */
      .thin-scroll::-webkit-scrollbar {
        height: 8px;
        width: 8px;
      }
      .thin-scroll::-webkit-scrollbar-thumb {
        background: rgba(0, 0, 0, 0.15);
        border-radius: 8px;
      }
    </style>
  </head>
  <body class="bg-gray-50 min-h-screen p-6">
    <div class="max-w-4xl mx-auto grid gap-6 lg:grid-cols-2">
      <!-- Left: Controls -->
      <div class="bg-white shadow rounded-lg p-6">
        <h1 class="text-xl font-semibold text-blue-600 mb-4">
          Socket & Notification Controls
        </h1>

        <!-- Token -->
        <label class="block text-sm font-medium text-gray-700">JWT Token</label>
        <input
          id="token"
          type="text"
          placeholder="paste JWT token"
          class="mt-1 mb-3 block w-full rounded-md border p-2"
        />

        <div class="flex gap-3 mb-4">
          <button
            id="connectBtn"
            class="flex-1 bg-green-600 text-white py-2 rounded shadow hover:bg-green-700"
          >
            Connect
          </button>
          <button
            id="disconnectBtn"
            class="flex-1 bg-red-500 text-white py-2 rounded shadow hover:bg-red-600"
          >
            Disconnect
          </button>
        </div>

        <div class="grid gap-2 sm:grid-cols-2 mb-4">
          <div>
            <label class="block text-sm font-medium text-gray-700"
              >Join Room</label
            >
            <div class="flex gap-2 mt-1">
              <input
                id="room"
                class="flex-1 rounded border p-2"
                placeholder="conversation:conv-123 or user:USER_ID"
              />
              <button id="joinBtn" class="px-3 bg-blue-500 text-white rounded">
                Join
              </button>
            </div>
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700"
              >Leave Room</label
            >
            <div class="flex gap-2 mt-1">
              <input
                id="leaveRoom"
                class="flex-1 rounded border p-2"
                placeholder="room name"
              />
              <button
                id="leaveBtn"
                class="px-3 bg-yellow-500 text-white rounded"
              >
                Leave
              </button>
            </div>
          </div>
        </div>

        <hr class="my-3" />

        <h2 class="font-semibold text-gray-800 mb-2">Send Test Notification</h2>

        <div class="grid gap-2">
          <label class="block text-sm text-gray-700"
            >Target userId (for DB + push)
          </label>
          <input
            id="targetUser"
            class="rounded border p-2"
            placeholder="user-uuid or leave blank for broadcast"
          />

          <label class="block text-sm text-gray-700">Title</label>
          <input
            id="notifTitle"
            class="rounded border p-2"
            placeholder="Notification title"
            value="Test notification"
          />

          <label class="block text-sm text-gray-700">Body</label>
          <input
            id="notifBody"
            class="rounded border p-2"
            placeholder="Notification body"
            value="Hello from tester"
          />

          <label class="block text-sm text-gray-700">Data (JSON)</label>
          <input
            id="notifData"
            class="rounded border p-2"
            placeholder='{"conversationId":"conv-123"}'
            value='{"source":"manual-test"}'
          />

          <div class="flex items-center gap-4 mt-2">
            <label class="inline-flex items-center gap-2">
              <input id="emitLocal" type="checkbox" checked />
              <span class="text-sm">emitLocally</span>
            </label>
            <label class="inline-flex items-center gap-2">
              <input
                id="useSocket"
                type="radio"
                name="sendMode"
                value="socket"
                checked
              />
              <span class="text-sm">Send via Socket</span>
            </label>
            <label class="inline-flex items-center gap-2">
              <input id="useHttp" type="radio" name="sendMode" value="http" />
              <span class="text-sm">Send via HTTP</span>
            </label>
          </div>

          <div class="flex gap-3 mt-3">
            <button
              id="sendNotifBtn"
              class="flex-1 bg-indigo-600 text-white py-2 rounded hover:bg-indigo-700"
            >
              Send Notification
            </button>
            <button id="clearLogBtn" class="px-3 bg-gray-200 rounded">
              Clear Log
            </button>
          </div>
        </div>

        <div class="mt-4">
          <h3 class="text-sm text-gray-600">Quick actions</h3>
          <div class="flex gap-2 mt-2">
            <button id="listNotifBtn" class="px-3 py-1 bg-slate-100 rounded">
              List DB notifications (GET)
            </button>
            <button id="markAllReadBtn" class="px-3 py-1 bg-slate-100 rounded">
              Mark all read (local)
            </button>
          </div>
        </div>
      </div>

      <!-- Right: Notifications & Log -->
      <div class="flex flex-col gap-4">
        <!-- Notifications panel -->
        <div class="bg-white shadow rounded-lg p-4">
          <div class="flex items-center justify-between">
            <h2 class="text-lg font-semibold">
              Notifications
              <span
                id="badge"
                class="ml-2 inline-flex items-center justify-center bg-red-500 text-white text-xs font-medium px-2 py-0.5 rounded-full"
                >0</span
              >
            </h2>
            <div class="text-sm text-gray-500">Live</div>
          </div>

          <div
            id="notifications"
            class="mt-3 max-h-64 overflow-y-auto thin-scroll space-y-2"
          >
            <!-- notifications appended here -->
            <div class="text-sm text-gray-400">No notifications yet</div>
          </div>

          <div class="mt-3 text-sm text-gray-500">
            Click a notification to mark as read.
          </div>
        </div>

        <!-- Event log -->
        <div class="bg-white shadow rounded-lg p-4">
          <div class="flex items-center justify-between mb-2">
            <h3 class="font-semibold text-gray-800">Event Log</h3>
            <div class="text-xs text-gray-500">Socket events & acks</div>
          </div>
          <div
            id="log"
            class="h-48 overflow-y-auto thin-scroll text-sm text-gray-800"
          ></div>
        </div>
      </div>
    </div>

    <script>
      let socket = null;
      let unreadCount = 0;
      const notifications = []; // local cache (client-side only)

      function nowISO() {
        return new Date().toISOString();
      }
      function timeShort(iso) {
        return new Date(iso).toLocaleString();
      }

      function addLog(txt) {
        const logDiv = document.getElementById('log');
        const p = document.createElement('div');
        p.className = 'py-1 border-b last:border-b-0';
        p.textContent = \`[\${new Date().toLocaleTimeString()}] \${txt}\`;
        logDiv.prepend(p);
      }

      function renderBadge() {
        const b = document.getElementById('badge');
        b.textContent = String(unreadCount || 0);
        b.style.display = unreadCount > 0 ? 'inline-flex' : 'none';
      }

      function renderNotifications() {
        const wrap = document.getElementById('notifications');
        wrap.innerHTML = '';
        if (!notifications.length) {
          const e = document.createElement('div');
          e.className = 'text-sm text-gray-400';
          e.textContent = 'No notifications yet';
          wrap.appendChild(e);
          return;
        }
        notifications
          .slice()
          .reverse()
          .forEach((n) => {
            const item = document.createElement('div');
            item.className =
              'p-2 rounded border hover:bg-gray-50 cursor-pointer flex justify-between items-start';
            if (!n.read) item.classList.add('bg-slate-50');

            const left = document.createElement('div');
            const title = document.createElement('div');
            title.className = 'font-medium text-gray-800';
            title.textContent = n.title || 'No title';
            const body = document.createElement('div');
            body.className = 'text-sm text-gray-600';
            body.textContent = n.body || '';

            left.appendChild(title);
            left.appendChild(body);

            const right = document.createElement('div');
            right.className = 'text-xs text-gray-500 text-right';
            right.innerHTML = \`\${timeShort(n.ts)}<br/><span class="mt-1">\${n.type || ''}</span>\`;

            item.appendChild(left);
            item.appendChild(right);

            item.addEventListener('click', () => {
              if (!n.read) {
                n.read = true;
                unreadCount = Math.max(0, unreadCount - 1);
                renderBadge();
                renderNotifications();
                addLog(\`Marked notification \${n.id || '(local)'} as read\`);
              }
            });

            wrap.appendChild(item);
          });
      }

      function pushNotification(n) {
        // n should contain { title, body, payload/data, ts, type, notificationId? }
        const rec = {
          id:
            n.notificationId ??
            n.payload?.notificationId ??
            \`local_\${Date.now()}_\${Math.random().toString(36).slice(2, 8)}\`,
          title:
            n.title ??
            (n.payload && n.payload.title) ??
            (n.payload && n.payload.summary) ??
            'Notification',
          body:
            n.body ??
            (n.payload && n.payload.body) ??
            JSON.stringify(n.payload || {}),
          data: n.data ?? n.payload ?? null,
          ts: n.ts ?? (n.payload && n.payload.ts) ?? nowISO(),
          type: n.type ?? n.payload?.type ?? 'notification',
          read: false,
        };
        notifications.push(rec);
        unreadCount += 1;
        renderBadge();
        renderNotifications();
        addLog('Received notification: ' + rec.title);
      }

      // get inputs
      const connectBtn = document.getElementById('connectBtn');
      const disconnectBtn = document.getElementById('disconnectBtn');
      const joinBtn = document.getElementById('joinBtn');
      const leaveBtn = document.getElementById('leaveBtn');
      const sendNotifBtn = document.getElementById('sendNotifBtn');
      const clearLogBtn = document.getElementById('clearLogBtn');
      const listNotifBtn = document.getElementById('listNotifBtn');
      const markAllReadBtn = document.getElementById('markAllReadBtn');

      connectBtn.addEventListener('click', () => {
        const token = document.getElementById('token').value.trim();
        if (!token) return alert('Enter JWT token');

        // create socket
        socket = io('http://localhost:5000', {
          auth: { token },
          transports: ['websocket'],
        });

        socket.on('connect', () => {
          addLog(\`Connected: \${socket.id}\`);
          // auto-join personal room (backend may do this but client can request)
          const userId = null; // if you want client to request a specific room, set user id here
        });

        socket.on('disconnect', (reason) => {
          addLog('Disconnected: ' + reason);
        });

        socket.on('connect_error', (err) => {
          addLog(
            'Connect error: ' + (err && (err.message || JSON.stringify(err)))
          );
        });

        // list of events to listen for
        socket.on('notification.new', (msg) => {
          // msg may be { event, payload, ... } or direct payload
          addLog('notification.new raw: ' + JSON.stringify(msg));
          // normalize and push
          const payload = msg && msg.payload ? msg.payload : msg;
          pushNotification(
            Object.assign({}, msg, {
              payload,
              title: payload.title,
              body: payload.body,
            })
          );
        });

        socket.on('chat.message', (msg) => {
          addLog('chat.message: ' + JSON.stringify(msg));
        });

        // generic catch-all for debug (optional)
        // socket.onAny((event, ...args) => addLog('onAny ' + event + ' ' + JSON.stringify(args)));
      });

      disconnectBtn.addEventListener('click', () => {
        if (!socket) return;
        socket.disconnect();
        socket = null;
      });

      joinBtn.addEventListener('click', () => {
        if (!socket) return alert('Connect first');
        const room = document.getElementById('room').value.trim();
        if (!room) return alert('Enter room');
        socket.emit('join', room);
        addLog('Requested join: ' + room);
      });

      leaveBtn.addEventListener('click', () => {
        if (!socket) return alert('Connect first');
        const room =
          document.getElementById('leaveRoom').value.trim() ||
          document.getElementById('room').value.trim();
        if (!room) return alert('Enter room to leave');
        socket.emit('leave', room);
        addLog('Requested leave: ' + room);
      });

      clearLogBtn.addEventListener('click', () => {
        document.getElementById('log').innerHTML = '';
      });

      markAllReadBtn.addEventListener('click', () => {
        notifications.forEach((n) => (n.read = true));
        unreadCount = 0;
        renderBadge();
        renderNotifications();
        addLog('Marked all notifications as read (client-only).');
      });

      listNotifBtn.addEventListener('click', async () => {
        const targetUser = document.getElementById('targetUser').value.trim();
        if (!targetUser) return alert('Enter userId to list notifications for');
        try {
          const res = await fetch(
            \`/api/test/notifications/\${encodeURIComponent(targetUser)}\`
          );
          const json = await res.json();
          addLog('List notifications response: ' + JSON.stringify(json));
          // optionally replace client list with returned list
          if (Array.isArray(json.notifications)) {
            notifications.length = 0;
            json.notifications.forEach((r) => {
              notifications.push({
                id: r.id,
                title: r.title,
                body: r.body,
                data: r.data,
                ts: r.createdAt,
                type: r.type,
                read: r.read,
              });
            });
            unreadCount = notifications.filter((n) => !n.read).length;
            renderBadge();
            renderNotifications();
          }
        } catch (e) {
          addLog('Error listing notifications: ' + e);
        }
      });

      // core: send test notification (socket OR HTTP)
      sendNotifBtn.addEventListener('click', async () => {
        const title = document.getElementById('notifTitle').value.trim();
        const body = document.getElementById('notifBody').value.trim();
        const dataStr = document.getElementById('notifData').value.trim();
        const targetUser = document.getElementById('targetUser').value.trim();
        let parsedData = null;
        try {
          parsedData = dataStr ? JSON.parse(dataStr) : null;
        } catch (e) {
          return alert('Invalid data JSON');
        }

        const emitLocally = document.getElementById('emitLocal').checked;
        const mode =
          document.querySelector('input[name="sendMode"]:checked')?.value ||
          'socket';

        const message = {
          event: 'notification.new',
          payload: {
            userId: targetUser || null,
            title,
            body,
            data: parsedData,
            ts: new Date().toISOString(),
          },
          room: targetUser ? \`user:\${targetUser}\` : undefined,
        };

        if (mode === 'socket') {
          if (!socket) return alert('Connect socket first');
          // send via socket with ack
          socket.emit('event_to_server', message, (ack) => {
            addLog('Socket ACK: ' + JSON.stringify(ack || {}));
          });
          addLog(
            'Sent notification via socket: ' + JSON.stringify(message.payload)
          );
        } else {
          // send via HTTP to test endpoint
          try {
            const res = await fetch('/api/test/notification', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                userId: targetUser || null,
                title,
                body,
                data: parsedData,
              }),
            });
            const json = await res.json();
            addLog('HTTP send response: ' + JSON.stringify(json));
          } catch (e) {
            addLog('HTTP send error: ' + String(e));
          }
        }

        // optional: if emitLocally, also show client-side notification immediately
        if (emitLocally) {
          pushNotification({
            notificationId: null,
            title,
            body,
            data: parsedData,
            ts: new Date().toISOString(),
          });
        }
      });

      // initial render
      renderBadge();
      renderNotifications();
    </script>
  </body>
</html>
`;
