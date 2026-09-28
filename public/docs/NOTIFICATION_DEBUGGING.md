# Notification System Debugging Guide

## Console Logs Added

I've added comprehensive console logs to debug the notification flow. When you create an appointment, you should see these logs in sequence:

### 1. Service Layer (appointment.service.ts)

```
🔔 [Notification Debug] performerUserId: <user-id>, userId: <user-id>
🔔 [Notification Debug] performer: { id, name, userType }
🔔 [Notification Debug] Calling notifyAppointmentCreated with: { ... }
🔔 [Notification Debug] notifyAppointmentCreated completed
```

### 2. Notification Helper (notificationHelpers.ts)

```
🔔 [notifyAppointmentCreated] START { clinicId, appointmentId, performerUserId, ... }
🔔 [notifyAppointmentCreated] Getting users by roles...
👥 [getUsersByRolesInClinic] START { clinicId, roles, excludeUserIds }
👥 [getUsersByRolesInClinic] Conditions count: X
👥 [getUsersByRolesInClinic] Found X users: [...]
🔔 [notifyAppointmentCreated] Users found: X [...]
🔔 [notifyAppointmentCreated] Getting doctor by ID: <doctor-id>
🔔 [notifyAppointmentCreated] Doctor found: { ... }
🔔 [notifyAppointmentCreated] Final users to notify: X
📤 [sendNotificationsToUsers] Sending to X users
📤 [sendNotificationsToUsers] Title: New Appointment Created
📤 [sendNotificationsToUsers] Body: A new appointment has been created by...
📤 [sendNotificationsToUsers] Users: [...]
📤 [sendNotificationsToUsers] Sending to user: <name> (<id>)
📤 [sendNotificationsToUsers] Results: [...]
🔔 [notifyAppointmentCreated] COMPLETED
```

## What to Check

### Step 1: Test Creating an Appointment

1. Create a new appointment
2. Check the console/terminal logs
3. Look for the logs above

### Step 2: Identify the Issue

#### If you see NO logs at all:

- The controller is not passing `performerUserId`
- Check if `req.user.id` is available in the controller

#### If you see logs but `performer` is null:

```
❌ [Notification Debug] No performer found!
```

- The `getUserById()` function is not finding the user
- Check if the user exists in the database

#### If you see "Users found: 0":

```
👥 [getUsersByRolesInClinic] Found 0 users
```

- No users with Admin/Doctor/Receptionist roles in the clinic
- Check the `clinic_assign` table
- Check if users have the correct roles

#### If you see users found but notifications not sent:

- Check the `sendNotificationToUser()` function
- Check if Kafka/Socket is working
- Look at the Results array for errors

### Step 3: Common Issues

1. **performerUserId is undefined**
   - Controller not passing `req.user.id`
   - Fix: Update controller to pass the parameter

2. **No users in clinic**
   - The clinic has no assigned users
   - Fix: Assign users to the clinic in `clinic_assign` table

3. **Wrong roles**
   - Users don't have Admin/Doctor/Receptionist roles
   - Fix: Update user roles in the database

4. **Performer is excluded correctly**
   - If performer has Doctor role and is the only doctor
   - They will be excluded from notifications (this is correct behavior)

## Testing Checklist

- [ ] Create appointment as Admin → Should notify Doctors and Receptionists
- [ ] Create appointment as Doctor → Should notify Admins and Receptionists
- [ ] Create appointment as Receptionist → Should notify Admins and Doctors
- [ ] Performer should NEVER receive their own notification
- [ ] Check console logs for each step
- [ ] Verify notification appears in the UI

## Next Steps

After checking the logs:

1. Share the console output with me
2. I'll identify the exact issue
3. We'll fix it together

## Quick Fix Commands

If you need to remove the console logs later:

```bash
# Search for all console.log statements
grep -r "console.log" src/utils/notificationHelpers.ts
grep -r "console.log" src/main/appointments/services/appointment.service.ts
```

Then manually remove or comment them out.
