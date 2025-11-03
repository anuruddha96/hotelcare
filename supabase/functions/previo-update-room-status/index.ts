import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { hotelId, roomNumber, status, assignmentId } = await req.json();
    
    if (!hotelId || !roomNumber || !status) {
      throw new Error('Hotel ID, room number, and status are required');
    }

    // Get Previo API credentials from environment
    const PREVIO_API_URL = Deno.env.get('PREVIO_API_URL');
    const PREVIO_API_USER = Deno.env.get('PREVIO_API_USER');
    const PREVIO_API_PASSWORD = Deno.env.get('PREVIO_API_PASSWORD');

    if (!PREVIO_API_URL || !PREVIO_API_USER || !PREVIO_API_PASSWORD) {
      throw new Error('Previo API credentials not configured');
    }

    console.log(`Updating room ${roomNumber} status to ${status} in Previo for hotel: ${hotelId}`);

    // Map Hotel Care status to Previo status
    const mapToPrevioStatus = (hotelCareStatus: string): string => {
      const statusMap: Record<string, string> = {
        'clean': 'clean',
        'dirty': 'dirty',
        'in_progress': 'dirty',
      };
      return statusMap[hotelCareStatus] || 'dirty';
    };

    const previoStatus = mapToPrevioStatus(status);

    // Call Previo API to update room status
    // Note: This endpoint may vary based on Previo's actual API
    // You may need to adjust this based on their documentation
    const response = await fetch(`${PREVIO_API_URL}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${btoa(`${PREVIO_API_USER}:${PREVIO_API_PASSWORD}`)}`,
      },
      body: JSON.stringify({
        method: 'Hotel.updateRoomStatus',
        params: {
          hotel_id: hotelId,
          room_number: roomNumber,
          status: previoStatus,
          timestamp: new Date().toISOString()
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Previo API error: ${response.status} ${response.statusText}`);
    }

    const previoData = await response.json();
    console.log('Previo response:', previoData);

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get authorization header
    const authHeader = req.headers.get('Authorization');
    let userId: string | null = null;
    
    if (authHeader) {
      const { data: { user } } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
      userId = user?.id || null;
    }

    // Log sync event
    await supabase.from('pms_sync_history').insert({
      sync_type: 'status_update',
      direction: 'to_previo',
      hotel_id: hotelId,
      data: {
        room_number: roomNumber,
        hotel_care_status: status,
        previo_status: previoStatus,
        assignment_id: assignmentId,
        response: previoData
      },
      changed_by: userId,
      sync_status: 'success',
    });

    console.log('Room status updated in Previo successfully');

    return new Response(
      JSON.stringify({ 
        success: true,
        message: `Room ${roomNumber} status updated to ${previoStatus} in Previo`,
        data: previoData
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Previo room status update error:', error);
    
    // Log failed sync
    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const supabase = createClient(supabaseUrl, supabaseKey);
      
      const { hotelId, roomNumber } = await req.json();
      
      await supabase.from('pms_sync_history').insert({
        sync_type: 'status_update',
        direction: 'to_previo',
        hotel_id: hotelId || null,
        data: { 
          room_number: roomNumber,
          error: error.message 
        },
        sync_status: 'failed',
        error_message: error.message
      });
    } catch (logError) {
      console.error('Failed to log error:', logError);
    }

    return new Response(
      JSON.stringify({ 
        success: false,
        error: error.message 
      }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
