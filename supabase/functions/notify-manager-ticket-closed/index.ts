import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.53.0';
import { Resend } from "npm:resend@2.0.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface NotificationRequest {
  ticketId: string;
  ticketNumber: string;
  title: string;
  resolutionText: string;
  closedBy: string;
  hotel?: string;
  roomNumber: string;
}

const handler = async (req: Request): Promise<Response> => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const resendApiKey = Deno.env.get('RESEND_API_KEY')!;

    const supabase = createClient(supabaseUrl, supabaseKey);
    const resend = new Resend(resendApiKey);

    const { ticketId, ticketNumber, title, resolutionText, closedBy, hotel, roomNumber }: NotificationRequest = await req.json();

    console.log('Processing ticket closure notification:', { ticketId, ticketNumber });

    // Get all managers and admins
    const { data: managers, error: managersError } = await supabase
      .from('profiles')
      .select('email, full_name')
      .in('role', ['manager', 'admin']);

    if (managersError) {
      console.error('Error fetching managers:', managersError);
      throw managersError;
    }

    if (!managers || managers.length === 0) {
      console.log('No managers found');
      return new Response(JSON.stringify({ message: 'No managers to notify' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Send email to each manager
    const emailPromises = managers.map(async (manager) => {
      const emailHtml = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px;">
            <h2 style="color: #28a745; margin-bottom: 20px;">✅ Ticket Closed - ${ticketNumber}</h2>
            
            <div style="background-color: white; padding: 20px; border-radius: 6px; margin-bottom: 20px;">
              <h3 style="color: #333; margin-top: 0;">${title}</h3>
              
              <div style="margin-bottom: 15px;">
                <strong>Hotel:</strong> ${hotel || 'N/A'}<br>
                <strong>Room:</strong> ${roomNumber}<br>
                <strong>Closed by:</strong> ${closedBy}
              </div>
              
              <div style="background-color: #f8f9fa; padding: 15px; border-radius: 4px; border-left: 4px solid #28a745;">
                <strong>Resolution:</strong><br>
                ${resolutionText}
              </div>
            </div>
            
            <div style="text-align: center; margin-top: 30px;">
              <a href="${supabaseUrl.replace('supabase.co', 'lovable.app')}" 
                 style="background-color: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
                View Dashboard
              </a>
            </div>
            
            <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #dee2e6; text-align: center; color: #6c757d; font-size: 12px;">
              RD Hotels Management System<br>
              This is an automated notification
            </div>
          </div>
        </div>
      `;

      return resend.emails.send({
        from: 'RD Hotels <notifications@resend.dev>',
        to: [manager.email],
        subject: `✅ Ticket Closed: ${ticketNumber} - ${title}`,
        html: emailHtml,
      });
    });

    const results = await Promise.allSettled(emailPromises);
    
    const successful = results.filter(result => result.status === 'fulfilled').length;
    const failed = results.filter(result => result.status === 'rejected');

    console.log(`Email notifications sent: ${successful}/${managers.length}`);
    
    if (failed.length > 0) {
      console.error('Some emails failed:', failed);
    }

    return new Response(JSON.stringify({ 
      message: `Notifications sent to ${successful} managers`,
      successful,
      total: managers.length
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('Error in notify-manager-ticket-closed function:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
};

serve(handler);