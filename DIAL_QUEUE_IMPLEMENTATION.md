# Dial Queue Implementation

## Overview
Built a complete Dial Queue page for the Easy Exit Hub React app that provides real-time outbound call scheduling and dispatch management.

## Files Created/Modified

### Created
- `src/pages/DialQueuePage.tsx` — Main dial queue component (22KB)

### Modified
- `src/App.tsx` — Added route `/queue` for DialQueuePage
- `src/components/common/AppLayout.tsx` — Added "Dial Queue" nav item with ListOrdered icon

### Dependencies Added
- `date-fns-tz` — For timezone-aware date formatting (America/New_York)

## Features Implemented

### 1. Summary Statistics Bar
- **Ready Now** — Follow-ups due + inside call window (green)
- **Upcoming** — Scheduled but not yet ready (blue)
- **Held** — Manually paused follow-ups (amber)
- **Blocked** — Not callable/approved or dead/dnc leads (red)
- **Next Window Time** — Shows when next call window opens (when outside windows)

### 2. Main Table with Comprehensive Lead Data
Each row displays:
- Lead name (linked to `/leads/:id`)
- Property address (from `property_data.address`)
- Phone number (formatted)
- Scheduled time (formatted with relative time: "2 hours ago")
- Reason/Kind (follow-up type + reason)
- Engagement badge (🔥 Hot, 🌡️ Warm, ❄️ Cold, 💀 Dead, 🚫 DNC)
- Cold attempts counter (e.g., "2/3")
- Last outcome badge (from most recent communication)
- Priority badge (red for >= 8, outline otherwise)
- Status badge (Ready Now/Upcoming/Held/Blocked)

### 3. Row Actions
- **Call Now** — POST to `trigger-call` edge function (only for "Ready Now" band)
- **Hold** — Set status to 'held'
- **Reschedule** — Opens dialog with date/time picker, updates `scheduled_for`
- **Cancel** — Set status to 'canceled' with timestamp
- **Open Lead** — External link icon to lead detail page

### 4. Filtering & Sorting
- Band filter buttons: All / Ready Now / Upcoming
- Count badges on each filter button
- Default sort: priority DESC, scheduled_for ASC

### 5. Call Window Logic (Display Only)
Windows: **10:30-12:00 ET** and **16:30-18:30 ET**

Band Classification:
- **Ready Now**: `status=pending AND scheduled_for <= now AND inside call window`
- **Upcoming**: `status=pending AND (scheduled_for > now OR outside window)`
- **Held**: `status=held`
- **Blocked**: lead not callable OR not outbound_approved OR engagement in (dead, dnc)

### 6. Auto-Refresh
- `refetchInterval: 30000` (30 seconds)
- Keeps queue current without manual refresh

### 7. Data Query Strategy
Single optimized query:
1. Fetch `follow_ups` with status in (pending, held, dialing, scheduled)
2. Join with `leads` table (owner_name, phone, property_data, engagement, etc.)
3. Fetch latest `communications` per lead for "last outcome"
4. Client-side classification into bands

### 8. Reschedule Dialog
- Date picker (native HTML5 date input)
- Time picker (native HTML5 time input)
- Timezone labeled as "ET" (America/New_York)
- Mutations invalidate query cache on success

## UI/UX Patterns
- Matches existing Easy Exit Hub design system
- Uses shadcn/ui components (Table, Badge, Button, Dialog, Card)
- Tailwind CSS for styling
- Responsive layout with AppLayout wrapper
- Toast notifications for actions (via `useToast`)
- Loading and empty states handled

## Edge Function Integration
- **Endpoint**: `${supabaseUrl}/functions/v1/trigger-call`
- **Method**: POST
- **Headers**: 
  - `Content-Type: application/json`
  - `Authorization: Bearer ${VITE_SUPABASE_PUBLISHABLE_KEY}`
- **Payload**: `{ lead_id: number }`

## Navigation
- **URL**: `/queue`
- **Icon**: ListOrdered (lucide-react)
- **Position**: Between Pipeline and Calls in sidebar

## Build Status
✅ TypeScript compilation: No errors
✅ Vite build: Success (720KB bundle)
✅ All imports resolved
✅ Route properly registered
✅ Nav item added to sidebar

## Next Steps / Potential Enhancements
- Add bulk actions (hold/cancel multiple)
- Add search/filter by lead name or phone
- Add "resume held" batch action
- Add disposition quick-select for post-call updates
- Add real-time updates via Supabase subscriptions
- Add export to CSV functionality
- Add metrics dashboard (calls per hour, conversion rates)
