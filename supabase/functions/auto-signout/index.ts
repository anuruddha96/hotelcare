import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabaseUrl = 'https://pcmszqqklkolvvlabohq.supabase.co'
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey)

    const today = new Date().toISOString().split('T')[0]

    // Find all staff still checked in or on break today
    const { data: records, error: fetchError } = await supabase
      .from('staff_attendance')
      .select('*')
      .eq('work_date', today)
      .in('status', ['checked_in', 'on_break'])
      .is('check_out_time', null)

    if (fetchError) {
      console.error('Error fetching records:', fetchError)
      return new Response(JSON.stringify({ error: fetchError.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (!records || records.length === 0) {
      return new Response(JSON.stringify({ message: 'No records to process', count: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    let processedCount = 0

    for (const record of records) {
      // Set checkout to 4:30 PM of the work date
      const checkoutTime = new Date(`${record.work_date}T16:30:00`)
      const checkInTime = new Date(record.check_in_time)
      
      // Calculate hours: from check-in to 4:30 PM minus break duration
      const hoursWorked = (checkoutTime.getTime() - checkInTime.getTime()) / (1000 * 60 * 60)
      const breakHours = (record.break_duration || 0) / 60
      const totalHours = Math.max(0, hoursWorked - breakHours)

      const { error: updateError } = await supabase
        .from('staff_attendance')
        .update({
          check_out_time: checkoutTime.toISOString(),
          status: 'auto_signout',
          total_hours: parseFloat(totalHours.toFixed(2)),
          notes: 'Auto signed out',
          updated_at: new Date().toISOString(),
        })
        .eq('id', record.id)

      if (updateError) {
        console.error(`Error updating record ${record.id}:`, updateError)
      } else {
        processedCount++
      }
    }

    console.log(`Auto sign-out completed: ${processedCount}/${records.length} records processed`)

    return new Response(
      JSON.stringify({ message: 'Auto sign-out completed', count: processedCount }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Auto sign-out error:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
