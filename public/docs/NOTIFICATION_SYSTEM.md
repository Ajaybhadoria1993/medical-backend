# Medisetu Notification System Implementation

## Overview

This document describes the implementation of the Medisetu Notification System following the specified notification rules.

## Important Rule

**👉 The user who performs an action will NOT receive a notification for that action.**

This rule is enforced in all notification helper functions by excluding the performer's user ID from the recipient list.

## User Roles

Notifications may be sent to the following roles:

- Admin
- Doctor
- Receptionist
- Lab (Lab_Assistant)
- Pharmacist

## Implementation Structure

### 1. Notification Helpers (`src/utils/notificationHelpers.ts`)

This file contains all the centralized notification helper functions that implement the notification rules.

#### Core Helper Functions:

- `getUsersByRolesInClinic()` - Get users by roles within a clinic, excluding specific users
- `getUserById()` - Get user details by ID
- `sendNotificationsToUsers()` - Send notifications to multiple users

#### Appointment Notification Functions:

- `notifyAppointmentCreated()` - Notifies Admin, Doctor, Receptionist (excluding performer)
- `notifyAppointmentRescheduled()` - Notifies Doctor (excluding performer)
- `notifyAppointmentConfirmed()` - Notifies Doctor (excluding performer)
- `notifyAppointmentCanceled()` - Notifies Doctor, Receptionist (excluding performer)

#### Test Module Notification Functions:

- `notifyTestLogCreated()` - Notifies Doctor or Lab (excluding performer and admin)
- `notifyTestAssignedToLab()` - Notifies assigned Lab (excluding performer)
- `notifyTestReportUploaded()` - Notifies all related users except uploader and admin

#### User Management Notification Functions:

- `notifyNewUserCreated()` - Notifies the new user

### 2. Implementation in Services

#### Appointment Service (`src/main/appointments/services/appointment.service.ts`)

Updated methods:

- `createAppointment()` - Added `performerUserId` parameter, calls `notifyAppointmentCreated()`
- `updateAppointment()` - Added `performerUserId` parameter, calls appropriate notification based on action:
  - `notifyAppointmentConfirmed()` when status is 'Confirmed'
  - `notifyAppointmentRescheduled()` when date/time changes
  - `notifyAppointmentCanceled()` when status is 'Cancelled'

#### Test Service (`src/main/test/services/appointmentTest.service.ts`)

Updated methods:

- `addTestToAppointment()` - Added `performerUserId` and `clinicId` parameters, calls `notifyTestLogCreated()`
- `updateAppointmentTest()` - Added `performerUserId` and `clinicId` parameters, calls:
  - `notifyTestReportUploaded()` when PDF is uploaded
  - `notifyTestAssignedToLab()` when lab is assigned

#### User Service (`src/main/users/services/user.service.ts`)

Updated methods:

- `addUser()` - Calls `notifyNewUserCreated()` after user creation

### 3. Implementation in Controllers

#### Appointment Controller (`src/main/appointments/controllers/appointment.controller.ts`)

- `createAppointmentController` - Passes `req.user.id` as `performerUserId`
- `updateAppointmentController` - Passes `req.user.id` as `performerUserId`

#### Test Controller (`src/main/test/controllers/appointmentTest.controller.ts`)

- `addTestToAppointmentController` - Passes `req.user.id` and `req.clinicId`
- `updateAppointmentTestController` - Passes `req.user.id` and `req.clinicId`

## Notification Catalog

### Appointment Notifications

#### New Appointment Created

- **Title**: New Appointment Created
- **Body**: A new appointment has been created by {name, role}. Please review the appointment details.
- **Notified**: Other Admin, Doctor, Receptionist (excluding performer)

#### Appointment Rescheduled

- **Title**: Appointment Rescheduled
- **Body**: An appointment has been rescheduled by {name, role}. Please check the updated date and time.
- **Notified**: Doctor (excluding performer)

#### Appointment Confirmed

- **Title**: Appointment Confirmed
- **Body**: The appointment has been confirmed by {name, role} successfully.
- **Notified**: Doctor (excluding performer)

#### Appointment Canceled

- **Title**: Appointment Canceled
- **Body**: An appointment has been canceled by {name, role}. Please take note of this update.
- **Notified**: Doctor, Receptionist (excluding performer)

### Test Module Notifications

#### Test Log Created

- **Title**: Test Log Created
- **Body**: A new test log has been created {clinic name}. Please review the test information.
- **Notified**: Doctor or Lab (excluding performer and admin)

#### Test Assigned to Lab

- **Title**: Test Assigned
- **Body**: A test has been assigned to your lab {dr name}. Please proceed with the required actions.
- **Notified**: Assigned Lab (excluding performer)

#### Test Report Uploaded

- **Title**: Test Report Uploaded
- **Body**: A test report has been uploaded by {name, role}. Please review the attached document.
- **Notified**: All related users except uploader and admin

### User Management Notifications

#### New User Created

- **Title**: New User Created
- **Body**: A new user has been added to the system with default access and notifications enabled.
- **Notified**: The new user

## Usage Examples

### Example 1: Creating an Appointment

```typescript
// In controller
const result = await AppointmentService.createAppointment(
  userId,
  clinicId,
  payload,
  req.user.id // Performer user ID
);
```

### Example 2: Uploading Test Report

```typescript
// In controller
const result = await AppointmentTestService.updateAppointmentTest(
  appointmentTestId,
  payload,
  req.user.id, // Performer user ID
  req.clinicId // Clinic ID
);
```

### Example 3: Adding New User

```typescript
// In service
await notifyNewUserCreated(newUser.id, newUser.name, newUser.userType);
```

## How It Works

1. **Action Performed**: User performs an action (e.g., creates appointment)
2. **Service Called**: Controller calls service method with performer information
3. **Get Performer Details**: Service fetches performer details from database
4. **Determine Recipients**: Notification helper determines who should be notified based on:
   - Action type
   - User roles
   - Clinic assignment
   - Excluding the performer
5. **Send Notifications**: Notifications are sent to all eligible recipients

## Benefits

1. **Centralized Logic**: All notification rules in one place
2. **Consistent Behavior**: Same notification logic across all modules
3. **Easy Maintenance**: Update rules in one place
4. **Type Safety**: TypeScript ensures correct usage
5. **Reusable**: Helper functions can be used anywhere
6. **Rule Enforcement**: Performer exclusion is automatic

## Future Enhancements

To add notifications for new actions:

1. Create a new helper function in `notificationHelpers.ts`
2. Call the helper from the appropriate service method
3. Pass performer information from the controller
4. Update this documentation

## Testing

To test notifications:

1. Perform an action (e.g., create appointment) as User A
2. Verify User A does NOT receive a notification
3. Verify other eligible users DO receive notifications
4. Check notification content matches the catalog
