import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { Resend } from "npm:resend@2.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface WorkAssignmentNotificationRequest {
  staff_id: string;
  assignment_type: 'ticket' | 'room_assignment';
  assignment_details: {
    id: string;
    title?: string;
    room_number?: string;
    priority?: string;
    assignment_type?: string;
  };
  hotel_name?: string;
}

const handler = async (req: Request): Promise<Response> => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { staff_id, assignment_type, assignment_details, hotel_name }: WorkAssignmentNotificationRequest = await req.json();

    // Initialize Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    );

    // Fetch staff email from profiles table
    const { data: staffProfile, error: staffError } = await supabaseClient
      .from('profiles')
      .select('email, full_name')
      .eq('id', staff_id)
      .single();

    if (staffError || !staffProfile?.email) {
      console.log('Staff member has no email or error fetching profile:', staffError);
      return new Response(
        JSON.stringify({ message: 'Staff member has no email configured' }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        }
      );
    }

    // Format assignment type for display
    const assignmentTypeDisplay = assignment_type === 'ticket' ? 'Maintenance Ticket' : 'Room Assignment';
    
    // Construct email body
    let emailSubject = `🔧 New ${assignmentTypeDisplay} - ${hotel_name || 'Hotel'}`;
    let emailBody = `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%); padding: 30px; border-radius: 12px 12px 0 0;">
          <h1 style="color: white; margin: 0; font-size: 24px;">🔧 New ${assignmentTypeDisplay}</h1>
          <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0 0;">HotelCare Maintenance System</p>
        </div>
        
        <div style="background: #f8f9fa; padding: 30px; border-radius: 0 0 12px 12px; border: 1px solid #e5e7eb; border-top: none;">
          <p style="font-size: 16px; margin-bottom: 20px;">Hello <strong>${staffProfile.full_name}</strong>,</p>
          
          <p style="margin-bottom: 20px;">You have been assigned a new ${assignment_type === 'ticket' ? 'maintenance ticket' : 'room task'} that requires your attention:</p>
          
          <div style="background: white; padding: 20px; border-radius: 8px; border-left: 4px solid #2563eb; margin: 20px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
    `;

    if (assignment_type === 'ticket') {
      const priorityColors: Record<string, string> = {
        urgent: '#dc2626',
        high: '#f97316',
        medium: '#eab308',
        low: '#22c55e'
      };
      const priorityColor = priorityColors[assignment_details.priority || 'medium'] || '#eab308';
      
      emailBody += `
            <h3 style="margin: 0 0 15px 0; color: #2563eb; font-size: 18px;">📋 Ticket Details</h3>
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 8px 0; color: #6b7280; width: 120px;"><strong>Issue:</strong></td>
                <td style="padding: 8px 0;">${assignment_details.title || 'N/A'}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #6b7280;"><strong>Room:</strong></td>
                <td style="padding: 8px 0; font-size: 18px; font-weight: bold;">${assignment_details.room_number || 'N/A'}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #6b7280;"><strong>Priority:</strong></td>
                <td style="padding: 8px 0;">
                  <span style="background: ${priorityColor}; color: white; padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: bold; text-transform: uppercase;">
                    ${assignment_details.priority || 'Medium'}
                  </span>
                </td>
              </tr>
            </table>
      `;
    } else {
      emailBody += `
            <h3 style="margin: 0 0 15px 0; color: #2563eb; font-size: 18px;">🏠 Room Assignment Details</h3>
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 8px 0; color: #6b7280; width: 120px;"><strong>Room:</strong></td>
                <td style="padding: 8px 0; font-size: 18px; font-weight: bold;">${assignment_details.room_number || 'N/A'}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #6b7280;"><strong>Type:</strong></td>
                <td style="padding: 8px 0;">${assignment_details.assignment_type || 'Cleaning'}</td>
              </tr>
            </table>
      `;
    }

    if (hotel_name) {
      emailBody += `
            <tr>
              <td style="padding: 8px 0; color: #6b7280;"><strong>Hotel:</strong></td>
              <td style="padding: 8px 0;">${hotel_name}</td>
            </tr>
      `;
    }

    emailBody += `
          </div>
          
          <p style="margin: 25px 0;">Please log in to the HotelCare app to view full details, add notes, upload photos, and update the status:</p>
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="https://hotelcare.app" 
               style="background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%); color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: bold; font-size: 16px; box-shadow: 0 4px 12px rgba(37, 99, 235, 0.3);">
              🔗 Open HotelCare App
            </a>
          </div>
          
          <div style="background: #fef3c7; padding: 15px; border-radius: 8px; margin: 25px 0;">
            <p style="margin: 0; color: #92400e; font-size: 14px;">
              <strong>⏰ Tip:</strong> Update the ticket status as you work to keep everyone informed of your progress.
            </p>
          </div>
          
          <p style="color: #6b7280; font-size: 14px;">
            If you have any questions, please contact your supervisor.
          </p>
          
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 25px 0;">
          <p style="color: #9ca3af; font-size: 12px; text-align: center;">
            This is an automated notification from HotelCare Maintenance System.<br>
            © ${new Date().getFullYear()} HotelCare.app
          </p>
        </div>
      </div>
    `;

    // Send email using Resend
    const emailResponse = await resend.emails.send({
      from: 'Maintenance System <noreply@resend.dev>',
      to: [staffProfile.email],
      subject: emailSubject,
      html: emailBody,
    });

    console.log('Email sent successfully:', emailResponse);

    return new Response(JSON.stringify(emailResponse), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders,
      },
    });
  } catch (error: any) {
    console.error('Error in send-work-assignment-notification function:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      }
    );
  }
};

serve(handler);