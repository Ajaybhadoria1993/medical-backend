# Specialty Order: Guide for the App Team

## What changed

The Super Admin can now set the order of the 33 main specialties from the web panel
(Speciality Defaults → Reorder). The patient app should show specialties in that order.

**You don't need a new API, and the response doesn't change.** The existing endpoint now
returns the list already sorted.

## The API

```
GET /api/v1/doctor/specialties
Authorization: Bearer <token>
```

Response (same shape as before):

```json
{
  "success": true,
  "message": "Specialty catalog",
  "data": [
    {
      "mainSpecialty": "Dentist",
      "specialties": ["Orthodontist", "Endodontist"],
      "alsoPractises": ["Oral Surgeon"],
      "symptoms": ["Toothache", "Bleeding gums"]
    }
  ]
}
```

- `data` is in the **Super Admin's order**. Item 0 is shown first.
- Before the Super Admin saves an order, the list comes back in the old default order.

## What the app must do

1. **Show `data` in the order received.** Don't sort it A–Z or by any other rule.
2. **Don't hard-code the specialty list or its order** in the app. Always use this API.
3. **Refresh the list** when the specialty screen opens, or at least once per app launch.
   If you cache it, keep it for no more than **24 hours**, or a new order won't show.
4. Match specialties by the `mainSpecialty` text, not by position. Positions change
   whenever the Super Admin reorders.

## Edge cases

| Case | What you get |
|---|---|
| No order saved yet | The default order, same as before this change |
| A new specialty is added later | It appears at the **end** of the list until the Super Admin reorders |
| The server can't read the saved order | The default order (the call still succeeds) |

## How to test

1. Ask the web team or a Super Admin to move one specialty (e.g. "Dentist") to the top and save.
2. Reopen the specialty screen in the app.
3. ✅ "Dentist" is first, and the rest match the order shown in the web panel.

## Not for the app

`PUT /api/v1/superadmin-analytics/specialty-positions` saves the order. It is Super Admin
only and only the web panel uses it. The app never calls it.
