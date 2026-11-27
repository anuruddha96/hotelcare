import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireRole } from '../_shared/requireAdmin.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  // Manual runs require a signed-in admin/manager. The unattended daily run is
  // handled entirely inside the database (public.run_auto_signout via pg_cron).
  const auth = await requireRole(req, ['admin', 'manager', 'housekeeping_manager', 'hr'])
  if (!auth.ok) {
    return new Response(JSON.stringify({ error: auth.error }), {
      status: auth.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey)


    if (!auth.organizationSlug) {
      return new Response(JSON.stringify({error:'Organization access required'}),{status:403,headers:{...corsHeaders,'Content-Type':'application/json'}})
    }
    const caller = createClient(supabaseUrl,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:req.headers.get('Authorization')!}}})
    if (auth.organizationSlug === 'rdhotels') {
      // The database verifies the active HR/admin caller and organization,
      // and uses exactly the same due-time and audit policy as the scheduler.
      const {data,error} = await caller.rpc('rd_attendance_manual_auto_signout')
      if(error) return new Response(JSON.stringify({error:'Unable to run safe automatic checkout'}),{status:error.code==='42501'?403:500,headers:{...corsHeaders,'Content-Type':'application/json'}})
      return new Response(JSON.stringify({message:'Auto sign-out completed',count:data}),{headers:{...corsHeaders,'Content-Type':'application/json'}})
    }
    // Preserve legacy cutoff for other organizations, but never let a manual
    // service-role run operate across organizations or a manager's hotel scope.
    let allowedIds: string[] | null = null
    if (auth.role === 'manager' || auth.role === 'housekeeping_manager') {
      const {data,error}=await caller.rpc('get_employees_by_hotel')
      if(error) return new Response(JSON.stringify({error:'Unable to verify employee access'}),{status:403,headers:{...corsHeaders,'Content-Type':'application/json'}})
      allowedIds=(data??[]).map((employee:{id:string})=>employee.id)
      if(!allowedIds.length)return new Response(JSON.stringify({count:0}),{headers:{...corsHeaders,'Content-Type':'application/json'}})
    }
    const today = new Date().toISOString().split('T')[0]

    // Find all staff still checked in or on break today
    let query = supabase
      .from('staff_attendance')
      .select('*')
      .eq('organization_slug',auth.organizationSlug)
      .eq('work_date', today)
      .in('status', ['checked_in', 'on_break'])
      .is('check_out_time', null)
    if(allowedIds)query=query.in('user_id',allowedIds)
    const {data:records,error:fetchError}=await query

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
        .eq('organization_slug',auth.organizationSlug)
        .is('check_out_time',null)

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
