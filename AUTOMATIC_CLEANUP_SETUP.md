# Automatic Photo Cleanup Setup

This document explains how to set up automatic daily cleanup of old room photos.

## What Gets Deleted

The system automatically deletes:
- **DND (Do Not Disturb) photos** older than 3 days
- **Room completion photos** older than 3 days

Photos that are **kept permanently**:
- Lost and found photos
- Maintenance issue photos
- Ticket attachments

## Setting Up Automatic Cleanup

### Step 1: Enable Required Extensions

1. Go to your Supabase Dashboard
2. Navigate to **Database** → **Extensions**
3. Enable the following extensions:
   - `pg_cron` - for scheduling
   - `pg_net` - for HTTP requests

### Step 2: Schedule the Cleanup Job

Run this SQL in your Supabase SQL Editor:

```sql
-- Schedule the cleanup to run daily at 2:00 AM UTC
SELECT cron.schedule(
  'daily-photo-cleanup',
  '0 2 * * *', -- Every day at 2:00 AM UTC
  $$
  SELECT
    net.http_post(
        url:='https://pcmszqqklkolvvlabohq.supabase.co/functions/v1/cleanup-old-photos',
        headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBjbXN6cXFrbGtvbHZ2bGFib2hxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTM4NjgxMDEsImV4cCI6MjA2OTQ0NDEwMX0.1PrIMW4wOXdmDNW6SrlBJa68H0k20n68hHy9PYOEvVo"}'::jsonb,
        body:='{"scheduled": true}'::jsonb
    ) as request_id;
  $$
);
```

### Step 3: Verify the Schedule

Check that the job was created:

```sql
SELECT * FROM cron.job WHERE jobname = 'daily-photo-cleanup';
```

## Manual Cleanup

Admins can also run the cleanup manually from:
- **System Management** tab in the Admin panel
- The cleanup shows storage status and pending files to be deleted

## Monitoring

The System Management page shows:
- Total storage usage (GB/MB)
- Total files count
- Pending cleanup count (files older than 3 days)
- Storage breakdown by bucket

## Changing the Schedule

To modify when the cleanup runs, update the cron schedule:

```sql
-- Unschedule the old job
SELECT cron.unschedule('daily-photo-cleanup');

-- Create a new schedule (example: every 6 hours)
SELECT cron.schedule(
  'daily-photo-cleanup',
  '0 */6 * * *', -- Every 6 hours
  $$ ... $$
);
```

## Cron Schedule Format

The format is: `minute hour day month weekday`

Examples:
- `0 2 * * *` - Every day at 2:00 AM
- `0 */6 * * *` - Every 6 hours
- `30 3 * * 0` - Every Sunday at 3:30 AM
- `0 0 1 * *` - First day of every month at midnight

## Troubleshooting

If automatic cleanup isn't working:

1. Check that extensions are enabled
2. Verify the cron job exists: `SELECT * FROM cron.job;`
3. Check cron job history: `SELECT * FROM cron.job_run_details WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'daily-photo-cleanup') ORDER BY start_time DESC LIMIT 10;`
4. Check edge function logs in Supabase Dashboard → Edge Functions → cleanup-old-photos
