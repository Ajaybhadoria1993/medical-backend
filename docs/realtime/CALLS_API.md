# Doctor → Reception Calls (ring and answer)

A doctor rings reception; receptionists answer ("I'm coming") or decline ("Can't come now").
Web is live on this contract. The mobile app should follow the same logic.

The old socket events (`call.reception`, `call.incoming`, `call.acknowledge`, `call.acknowledged`,
`call.decline`, `call.declined`, `call.cancel`, `call.cancelled`, `call.wait`, `call.waited`)
**have been removed**. Do not use them.

## Rules

| Rule | Detail |
|---|---|
| Who can call | `Doctor`, or `Admin` with `isAdminDoctorAccess` |
| Who gets rung | Receptionists **assigned to that doctor** (staff assignment; "all doctors" or not configured = assigned to everyone) **and online right now** (connected socket) |
| Default | All assigned, online receptionists. The doctor may pick one instead. |
| Call types | `RECEPTION` (default, loud tone), `NEXT_PATIENT` (soft tone) |
| Ring time | 30 seconds, then the call is **missed** |
| One call at a time | A doctor can't place a second call while one is ringing (409) |
| First answer wins | A second receptionist answering gets 409 "Priya already answered this call." |
| Decline | Only stops that receptionist's ringing. When **every** recipient declined, the call is **busy**. |
| Clinic | Always taken from the login token. Never sent by the client. |
| Storage | Redis only, 2 minutes. No call history. |

Statuses: `ringing` · `answered` · `busy` · `missed` · `cancelled`.

## Endpoints

All need `Authorization: Bearer <token>`. Responses use the standard `{ success, message, data }` envelope.

| Method | Path | Who | Body | `data` |
|---|---|---|---|---|
| GET | `/api/v1/calls/active` | anyone in the clinic | query `withReceptionists=true` (doctor, optional) | `ActiveCalls` |
| POST | `/api/v1/calls` | doctor | `{ "type": "RECEPTION" \| "NEXT_PATIENT", "receptionistId"?: uuid }` | `Call` (201) |
| POST | `/api/v1/calls/:callId/answer` | receptionist | — | `Call` |
| POST | `/api/v1/calls/:callId/decline` | receptionist | — | `Call` |
| POST | `/api/v1/calls/:callId/cancel` | the calling doctor | — | `Call` |

```ts
type Call = {
  id: string; clinicId: string; type: "RECEPTION" | "NEXT_PATIENT";
  doctor: { id: string; name: string; profileImage: string | null };
  target: { id: string; name: string } | null; // set when one receptionist was picked
  status: "ringing" | "answered" | "busy" | "missed" | "cancelled";
  answeredBy: { id: string; name: string } | null;
  createdAt: string; expiresAt: string; endedAt: string | null;
};

type ActiveCalls = {
  incoming: Call[];          // ringing for me (receptionist), oldest first
  myCall: Call | null;       // my latest call in any status (doctor)
  receptionists?: { id: string; name: string }[]; // only with withReceptionists=true
  serverTime: string;        // use with expiresAt; don't trust the device clock
};
```

Errors. Show the `message` for 409s; it's written for users:

| Status | Message |
|---|---|
| 409 | "No receptionist is online right now." |
| 409 | "That receptionist is no longer online. Choose someone else." |
| 409 | "You already have a call ringing." |
| 409 | "Priya already answered this call." / "This call has ended." |
| 404 | "This call has ended." (not found, or not addressed to you) |

## Keeping in sync

Calls use the standard realtime signal (see `REALTIME_SIGNAL_CONTRACT.md`):

- Section: `calls:{clinicId}`, event `realtime.section.changed`.
- On a signal with a new version, refetch `GET /calls/active`. That is the only source of truth.
- Also refetch **on socket reconnect** and **when the app returns to the foreground**.
- A ringing call turns into `missed` **without a signal**. Set a timer for
  `expiresAt - serverTime` (+ ~0.5 s) and refetch then.
- After answer/decline/cancel, use the response (or remove the call locally on 404/409). No extra refetch.

## Screens

**Doctor**
- Main button "Call reception" places `{ type: "RECEPTION" }` at once.
- More options: "Call for" Reception / Next patient, and "Who to ring": All reception (N online) or one
  name (from `withReceptionists=true`, fetched when the options open).
- While `myCall.status === "ringing"`, show only **Cancel call**.

| State | Text |
|---|---|
| ringing | "Calling reception…" / "Calling Priya…" / next patient: "Asking for the next patient…" |
| answered | "Priya is on the way." / next patient: "Priya is sending the next patient in."  |
| busy | "Reception is busy right now." / "Priya can't come right now." / next patient: "No one can send a patient right now." + Try again |
| missed | "No one answered." + Try again |
| offline | "You're offline. Reconnect to call." |

An ended call (answered, busy, missed, not sent) hides after 8 s or on a tap outside it. A ringing call never hides.

**Receptionist**
- Ring (looping tone + vibration) while `incoming` is not empty; stop when it empties.
- Labels follow the type. Reception: "The doctor needs you", **I'm coming** / **Can't come now**.
  Next patient: "Send in the next patient", **Send patient in** / **Not right now**.
- Show the oldest call first, with "Only you" (target set) or "All reception".
  If more calls are waiting, show "2 more calls are waiting after this one."
- Keep ringing when the app isn't in front. Web does this with a system notification in a background
  tab. **No push is sent for calls yet**, so a closed or suspended mobile app won't ring. That needs a backend push.
- Show a 30-second countdown from `expiresAt` (corrected by `serverTime`).
- The popup never closes by itself. **Closing it declines the call**, so the doctor always gets an answer.
