# Staff Management — Frontend Integration Guide

This document covers all frontend changes required after the unified staff limit system was implemented.

---

## Summary of Backend Changes

| Change                                                                                           | Impact on Frontend                      |
| ------------------------------------------------------------------------------------------------ | --------------------------------------- |
| Unified staff limit (Receptionist, Nurse, Pharmacist, Lab_Assistant, Radiologist share one pool) | Update limit display UI                 |
| `addUser` schema now requires `pharmacyId` for Pharmacist                                        | Update Add Staff form                   |
| `addUser` schema now requires `labId` for Lab_Assistant                                          | Enforce in form validation              |
| `addUser` schema restricts `userType` to staff/doctor only                                       | Remove Admin/Patient/User from dropdown |
| Feature prerequisite check (Lab_Assistant → lab_integration, Pharmacist → pharmacy_integration)  | Show feature-locked message             |
| Staff deactivation on plan expiry                                                                | Handle deactivated users in UI          |
| Staff reactivation on plan upgrade                                                               | Show reactivation info post-payment     |
| Cancel subscription returns warnings + deactivated users                                         | Display in cancellation confirmation    |

---

## 1. Add Staff Form Changes

### Allowed User Types (dropdown)

Only these types can be added via the `/adduser` endpoint now:

```typescript
const ALLOWED_STAFF_TYPES = [
  'Doctor',
  'Receptionist',
  'Nurse',
  'Pharmacist',
  'Lab_Assistant',
  'Radiologist',
] as const;
```

Remove `Admin`, `User`, `Super_Admin`, and `Patient` from the Add Staff dropdown.

### Conditional Fields

| User Type     | Required Fields             | Optional Fields                        |
| ------------- | --------------------------- | -------------------------------------- |
| Doctor        | name, email                 | speciality, registrationNumber, mobile |
| Receptionist  | name, email                 | mobile                                 |
| Nurse         | name, email                 | mobile                                 |
| Pharmacist    | name, email, **pharmacyId** | mobile                                 |
| Lab_Assistant | name, email, **labId**      | mobile                                 |
| Radiologist   | name, email                 | mobile                                 |

### Form Validation (Client-Side)

```typescript
// Show pharmacy selector when userType === 'Pharmacist'
if (userType === 'Pharmacist' && !pharmacyId) {
  setError('pharmacyId', 'Please select a pharmacy');
}

// Show lab selector when userType === 'Lab_Assistant'
if (userType === 'Lab_Assistant' && !labId) {
  setError('labId', 'Please select a lab');
}
```

### Request Body

```typescript
// POST /api/v1/users/adduser
interface AddUserRequest {
  name: string;
  email: string;
  userType: 'Doctor' | 'Receptionist' | 'Nurse' | 'Pharmacist' | 'Lab_Assistant' | 'Radiologist';
  mobile?: string;
  speciality?: string | null;       // Recommended for Doctor
  registrationNumber?: string | null; // For Doctor
  labId?: string;                    // Required for Lab_Assistant
  pharmacyId?: string;               // Required for Pharmacist
}
```

---

## 2. Error Handling for Add Staff

### New Error Responses

| HTTP | Error Message                                                                              | When                                            | Frontend Action                               |
| ---- | ------------------------------------------------------------------------------------------ | ----------------------------------------------- | --------------------------------------------- |
| 403  | "Staff account limit reached on your current plan."                                        | Any staff type exceeds unified limit            | Show upgrade modal or add-on purchase         |
| 403  | "Doctor account limit reached on your current plan."                                       | Doctor limit reached                            | Show upgrade modal                            |
| 403  | "Your current plan does not support adding Lab Assistant users. Please upgrade your plan." | Lab_Assistant without lab_integration feature   | Show feature-locked message, suggest CareHub plan |
| 403  | "Your current plan does not support adding Pharmacist users. Please upgrade your plan."    | Pharmacist without pharmacy_integration feature | Show feature-locked message, suggest CareHub plan |
| 400  | "labId is required when adding a Lab Assistant"                                            | Missing labId                                   | Show field validation error                   |
| 400  | "pharmacyId is required when adding a Pharmacist"                                          | Missing pharmacyId                              | Show field validation error                   |

### Example Error Handler

```typescript
async function handleAddUser(data: AddUserRequest) {
  try {
    const res = await api.post('/users/adduser', data);
    toast.success(res.data.message);
  } catch (error) {
    if (error.response?.status === 403) {
      const message = error.response.data.message;
      
      if (message.includes('limit reached')) {
        // Show upgrade modal
        showUpgradeModal({
          title: 'Account Limit Reached',
          message,
          showAddOnOption: data.userType !== 'Doctor',
        });
      } else if (message.includes('does not support')) {
        // Feature not available on plan
        showFeatureLockedModal({
          feature: data.userType === 'Lab_Assistant' ? 'Lab Integration' : 'Pharmacy Integration',
          message,
        });
      }
    } else if (error.response?.status === 400) {
      // Validation error — show field-level errors
      toast.error(error.response.data.message);
    }
  }
}
```

---

## 3. Limits Overview Display

### Endpoint

```
GET /api/v1/subscription/limitations/overview
```

### Response Shape (Updated)

```typescript
interface LimitsOverviewResponse {
  plan: {
    planId: string;
    planSlug: string; // 'Free' | 'pro-monthly' | 'pro-yearly'
  };
  limits: Array<{
    featureKey: string;
    description: string | null;
    enabled: boolean;
    baseLimit: number;
    addOnLimit: number;
    totalLimit: number;
    isUnlimited: boolean;
    currentUsage: number;
    remaining: number | null;
  }>;
}
```

### Key Feature Keys to Display

| Feature Key                   | Display Label        | Type                       |
| ----------------------------- | -------------------- | -------------------------- |
| `doctor_accounts`             | Doctors              | Count (X/Y)                |
| `staff_accounts`              | Staff Members        | Count (X/Y)                |
| `whatsapp_messages_per_month` | WhatsApp Messages    | Count (X/Y)                |
| `lab_integration`             | Lab Integration      | Boolean (Enabled/Disabled) |
| `pharmacy_integration`        | Pharmacy Integration | Boolean (Enabled/Disabled) |
| `storage_months`              | Data Retention       | Duration                   |

### Staff Limit Display

The `staff_accounts` counts ALL staff (Receptionist, Nurse, Pharmacist, Lab Assistant, Radiologist).

```tsx
function StaffLimitCard({ limits }) {
  const staffLimit = limits.find(
    l => l.featureKey === 'staff_accounts'
  );

  if (!staffLimit) return null;

  return (
    <Card>
      <h3>Staff Members</h3>
      <p>Includes: Receptionist, Nurse, Pharmacist, Lab Assistant, Radiologist</p>
      <ProgressBar 
        current={staffLimit.currentUsage} 
        max={staffLimit.totalLimit} 
      />
      <span>{staffLimit.currentUsage} / {staffLimit.totalLimit} used</span>
      {staffLimit.remaining === 0 && (
        <Alert type="warning">
          Staff limit reached. <Link to="/subscription">Upgrade</Link> or purchase an add-on.
        </Alert>
      )}
    </Card>
  );
}
```

---

## 4. Subscription Cancellation

### Endpoint

```
PUT /api/v1/subscription/cancel/:subscriptionId
```

### Updated Response

```typescript
interface CancelSubscriptionResponse {
  success: true;
  message: 'Clinic subscription cancelled successfully';
  data: {
    warnings: string[];
    doctorsDeactivated: Array<{ id: string; name: string; email: string }>;
    staffDeactivated: Array<{ id: string; name: string; email: string; userType: string }>;
  };
}
```

### Frontend Flow

```tsx
async function handleCancelSubscription(subscriptionId: string) {
  // Step 1: Show confirmation dialog
  const confirmed = await showConfirmDialog({
    title: 'Cancel Subscription?',
    message: 'Cancelling your plan will deactivate excess staff members who exceed the free plan limits.',
    confirmText: 'Cancel Subscription',
    variant: 'destructive',
  });

  if (!confirmed) return;

  // Step 2: Call API
  const res = await api.put(`/subscription/cancel/${subscriptionId}`);
  const { warnings, doctorsDeactivated, staffDeactivated } = res.data.data;

  // Step 3: Show results
  if (doctorsDeactivated.length > 0 || staffDeactivated.length > 0) {
    showDeactivationReport({
      warnings,
      doctors: doctorsDeactivated,
      staff: staffDeactivated,
    });
  } else {
    toast.success('Subscription cancelled. No staff were affected.');
  }
}
```

### Deactivation Report Modal

```tsx
function DeactivationReportModal({ warnings, doctors, staff }) {
  return (
    <Modal title="Subscription Cancelled">
      {warnings.map(w => <Alert type="warning">{w}</Alert>)}
      
      {doctors.length > 0 && (
        <section>
          <h4>Deactivated Doctors ({doctors.length})</h4>
          <ul>
            {doctors.map(d => <li key={d.id}>{d.name} ({d.email})</li>)}
          </ul>
        </section>
      )}

      {staff.length > 0 && (
        <section>
          <h4>Deactivated Staff ({staff.length})</h4>
          <ul>
            {staff.map(s => (
              <li key={s.id}>{s.name} — {s.userType.replace('_', ' ')} ({s.email})</li>
            ))}
          </ul>
        </section>
      )}

      <p>These users can be reactivated by upgrading your plan.</p>
      <Button onClick={goToPricingPage}>Upgrade Now</Button>
    </Modal>
  );
}
```

---

## 5. Subscription Upgrade (Verify & Subscribe)

### Updated Response

```
POST /api/v1/subscription/verify-subscription
```

```typescript
interface VerifySubscriptionResponse {
  success: true;
  message: 'Payment verified and subscription activated';
  data: {
    subscription: ClinicSubscription;
    staffReactivated: number;    // NEW
    doctorsReactivated: number;  // NEW
  };
}
```

### Frontend Flow After Payment

```typescript
async function handlePaymentSuccess(paymentData) {
  const res = await api.post('/subscription/verify-subscription', paymentData);
  const { staffReactivated, doctorsReactivated } = res.data.data;

  if (staffReactivated > 0 || doctorsReactivated > 0) {
    toast.success(
      `Subscription activated! ${doctorsReactivated} doctor(s) and ${staffReactivated} staff member(s) have been reactivated.`
    );
  } else {
    toast.success('Subscription activated successfully!');
  }

  // Refresh staff list and limits
  refetchStaffList();
  refetchLimitsOverview();
}
```

---

## 6. Staff List — Handling Deactivated Users

### Identifying Deactivated Staff

Deactivated staff have:
- `isArchive: true`
- `userStatus: 'Inactive'`

### UI Recommendation

```tsx
function StaffListItem({ user }) {
  const isDeactivated = user.isArchive && user.userStatus === 'Inactive';

  return (
    <tr className={isDeactivated ? 'opacity-50' : ''}>
      <td>{user.name}</td>
      <td>{user.userType.replace('_', ' ')}</td>
      <td>{user.email}</td>
      <td>
        {isDeactivated ? (
          <Badge variant="destructive">Deactivated (Plan Limit)</Badge>
        ) : (
          <Badge variant="success">Active</Badge>
        )}
      </td>
    </tr>
  );
}
```

### Manual Reactivation (Admin)

```
POST /api/v1/subscription/limitations/reactivate-staff
```

No request body needed — uses clinic context from auth.

```typescript
interface ReactivateStaffResponse {
  success: true;
  message: 'Staff reactivated successfully';
  data: {
    doctorsReactivated: number;
    staffReactivated: number;
  };
}
```

---

## 7. Manual Enforcement (Admin/Cron)

If you need a button for Super Admin to force-enforce limits on a specific clinic:

```
POST /api/v1/subscription/limitations/enforce-staff-limits
```

**Request:**
```json
{ "clinicId": "uuid-of-clinic" }
```

**Response:**
```typescript
interface EnforceStaffLimitsResponse {
  success: true;
  data: {
    doctorsDeactivated: Array<{ id: string; name: string; email: string }>;
    staffDeactivated: Array<{ id: string; name: string; email: string; userType: string }>;
    warnings: string[];
  };
}
```

---

## 8. Add-On Purchase — Staff Add-On

The existing `additional_staff` add-on now covers ALL staff types (not just receptionists).

### Update Add-On Display Text

```diff
- "Additional Receptionist — ₹99/month"
+ "Additional Staff Slot — ₹99/month"
+   Covers: Receptionist, Nurse, Pharmacist, Lab Assistant, Radiologist
```

---

## 9. Migration Checklist for Frontend

- [ ] Update Add Staff form: add `pharmacyId` field (shown when userType is Pharmacist)
- [ ] Update Add Staff form: make `labId` required when userType is Lab_Assistant
- [ ] Update Add Staff form: remove Admin/User/Patient/Super_Admin from userType dropdown
- [ ] Update limits display: show "Staff Members" for `staff_accounts`
- [ ] Update cancel subscription flow: handle `warnings`, `doctorsDeactivated`, `staffDeactivated` in response
- [ ] Update verify-subscription success handler: show reactivation counts
- [ ] Update staff list: show deactivated badge for `isArchive: true` users
- [ ] Add "Reactivate Staff" button on subscription page (calls `/limitations/reactivate-staff`)
- [ ] Update add-on labels: "Additional Staff Slot" instead of "Additional Receptionist"
- [ ] Handle 403 errors with feature-locked messaging for Lab_Assistant and Pharmacist

---

## 10. TypeScript Types (for frontend)

```typescript
type StaffUserType = 'Receptionist' | 'Nurse' | 'Pharmacist' | 'Lab_Assistant' | 'Radiologist';
type DoctorUserType = 'Doctor';
type AddableUserType = DoctorUserType | StaffUserType;

interface AddUserPayload {
  name: string;
  email: string;
  userType: AddableUserType;
  mobile?: string;
  speciality?: string | null;
  registrationNumber?: string | null;
  labId?: string;        // Required for Lab_Assistant
  pharmacyId?: string;   // Required for Pharmacist
}

interface StaffLimitInfo {
  allowed: boolean;
  currentUsage: number;
  limit: number | null;
  isUnlimited: boolean;
  remaining: number | null;
  message?: string;
}

interface CancelResult {
  warnings: string[];
  doctorsDeactivated: { id: string; name: string | null; email: string | null }[];
  staffDeactivated: { id: string; name: string | null; email: string | null; userType: string }[];
}
```
