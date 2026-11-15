# Medicine Module - Frontend Integration Guide

## Summary of Backend Changes

The medicine CRUD lifecycle has been optimized with the following changes:

1. **Soft-delete + Re-add**: If a medicine was previously deleted and the same name+form is created again, it gets **reactivated** (not duplicated).
2. **Case-insensitive duplicate detection**: "Paracetamol" and "paracetamol" are now treated as the same medicine.
3. **New Toggle Status endpoint**: Medicines can be disabled/enabled without deleting.
4. **`getAllMedicines` now returns global + user medicines** (previously only returned user's own).
5. **`isActive` field** is now included in list/search responses.

---

## New API Endpoint

### PATCH `/api/v1/medicine/medicines/:medicineId/toggle-status`

Toggle a medicine's active status (enable/disable).

**Request Body:**
```json
{
  "isActive": true | false
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "name": "Paracetamol",
    "form": "Tablet",
    "isActive": false,
    ...
  }
}
```

**Error Responses:**
- `404` - Medicine not found or not owned by user
- `409` - Cannot reactivate: an active medicine with same name+form already exists

---

## Frontend Modifications Required

### 1. Medicine List Table - Add Status Column

Add an `isActive` status indicator to the medicine list/table:

```tsx
// Example column definition
{
  header: 'Status',
  accessorKey: 'isActive',
  cell: ({ row }) => (
    <Badge variant={row.original.isActive ? 'success' : 'secondary'}>
      {row.original.isActive ? 'Active' : 'Disabled'}
    </Badge>
  )
}
```

### 2. Add Enable/Disable Toggle Button

Replace or supplement the delete button with a toggle:

```tsx
// Toggle status handler
const handleToggleStatus = async (medicineId: string, currentStatus: boolean) => {
  try {
    await api.patch(`/medicine/medicines/${medicineId}/toggle-status`, {
      isActive: !currentStatus,
    });
    // Refresh the list
    refetchMedicines();
    toast.success(currentStatus ? 'Medicine disabled' : 'Medicine enabled');
  } catch (error) {
    if (error.response?.status === 409) {
      toast.error('Cannot enable: a medicine with same name already exists');
    } else {
      toast.error('Failed to update medicine status');
    }
  }
};
```

**UI suggestion:** Use a Switch/Toggle component in the actions column:
```tsx
<Switch
  checked={medicine.isActive}
  onCheckedChange={() => handleToggleStatus(medicine.id, medicine.isActive)}
/>
```

### 3. Update Delete Confirmation Dialog

Change the delete dialog to inform users about the behavior:

```tsx
<AlertDialog>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>Delete Medicine?</AlertDialogTitle>
      <AlertDialogDescription>
        This will deactivate "{medicine.name}". You can re-add it later 
        with the same name and it will be restored. Alternatively, you 
        can disable it using the toggle to keep it in your list.
      </AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel>Cancel</AlertDialogCancel>
      <Button variant="outline" onClick={() => handleToggleStatus(medicine.id, true)}>
        Disable Instead
      </Button>
      <AlertDialogAction onClick={() => handleDelete(medicine.id)}>
        Delete
      </AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

### 4. Handle 409 Conflict on Create

The create endpoint now returns `409` (instead of `500`) when a duplicate exists:

```tsx
const handleCreateMedicine = async (data: MedicineFormData) => {
  try {
    const response = await api.post('/medicine/medicines', data);
    toast.success('Medicine created successfully');
    // Note: If the medicine was previously deleted, it gets reactivated automatically
    return response.data;
  } catch (error) {
    if (error.response?.status === 409) {
      toast.error('A medicine with this name and form already exists');
    } else {
      toast.error('Failed to create medicine');
    }
  }
};
```

### 5. Add Filter for Active/Disabled Medicines

Add a filter dropdown to the medicine list:

```tsx
<Select value={statusFilter} onValueChange={setStatusFilter}>
  <SelectTrigger>
    <SelectValue placeholder="Status" />
  </SelectTrigger>
  <SelectContent>
    <SelectItem value="all">All</SelectItem>
    <SelectItem value="active">Active Only</SelectItem>
    <SelectItem value="disabled">Disabled Only</SelectItem>
  </SelectContent>
</Select>
```

When using the search endpoint, pass `isActive` query param:
```tsx
// For search endpoint
const params = {
  q: searchQuery,
  ...(statusFilter === 'active' && { isActive: true }),
  ...(statusFilter === 'disabled' && { isActive: false }),
  // Don't pass isActive for "all" - backend defaults to active only
};
```

**Important:** To show disabled medicines, you MUST explicitly pass `isActive=false` in the search query. The default behavior only returns active medicines.

### 6. Visual Distinction for Disabled Medicines

Style disabled medicines differently in the list:

```tsx
<TableRow 
  className={cn(
    !medicine.isActive && 'opacity-50 bg-muted'
  )}
>
  {/* ... cells ... */}
</TableRow>
```

### 7. Update Medicine Type Definition

```typescript
interface Medicine {
  id: string;
  name: string;
  genericName?: string;
  manufacturer?: string;
  composition?: string;
  form?: string;
  strength?: string;
  category?: string;
  requiresPrescription: boolean;
  isFavorite: boolean;
  isActive: boolean;  // <-- ADD THIS
}
```

---

## Behavioral Changes to Note

| Scenario                       | Old Behavior                               | New Behavior                                     |
| ------------------------------ | ------------------------------------------ | ------------------------------------------------ |
| Delete + re-add same medicine  | DB constraint error or duplicate row       | Reactivates the old record with updated fields   |
| "Paracetamol" vs "paracetamol" | Treated as different                       | Treated as same (409 conflict)                   |
| Delete action                  | Permanent soft-delete, no way back from UI | Can be restored by creating same name+form again |
| Medicine list                  | Only user's medicines                      | User's + Global medicines                        |
| Disable without delete         | Not possible                               | Use toggle-status endpoint                       |

---

## API Response Changes

All list/search endpoints now include `isActive` in the response:

```json
{
  "success": true,
  "medicines": [
    {
      "id": "...",
      "name": "Paracetamol",
      "form": "Tablet",
      "isActive": true,
      ...
    }
  ]
}
```
