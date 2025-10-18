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
    const assignmentTypeDisplay = assignment_type === 'ticket' ? 'Ticket Assignment' : 'Room Assignment';
    
    // Construct email body
    let emailSubject = `New ${assignmentTypeDisplay}`;
    let emailBody = `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <div style="text-align: center; margin-bottom: 20px;">
          <img src="https://rdhotels-management.lovable.app/logo.png" alt="HotelCare.app" style="height: 60px; width: auto;">
        </div>
        
        <h2 style="color: #2563eb;">New ${assignmentTypeDisplay}</h2>
        
        <p>Hello ${staffProfile.full_name},</p>
        
        <p>You have been assigned a new ${assignment_type === 'ticket' ? 'maintenance ticket' : 'room cleaning task'}:</p>
        
        <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; margin: 20px 0;">
    `;

    if (assignment_type === 'ticket') {
      emailBody += `
          <h3 style="margin-top: 0; color: #2563eb;">Ticket Details</h3>
          <p><strong>Title:</strong> ${assignment_details.title || 'N/A'}</p>
          <p><strong>Room:</strong> ${assignment_details.room_number || 'N/A'}</p>
          <p><strong>Priority:</strong> ${assignment_details.priority || 'Medium'}</p>
      `;
    } else {
      emailBody += `
          <h3 style="margin-top: 0; color: #2563eb;">Room Assignment Details</h3>
          <p><strong>Room:</strong> ${assignment_details.room_number || 'N/A'}</p>
          <p><strong>Assignment Type:</strong> ${assignment_details.assignment_type || 'Cleaning'}</p>
      `;
    }

    if (hotel_name) {
      emailBody += `<p><strong>Hotel:</strong> ${hotel_name}</p>`;
    }

    emailBody += `
        </div>
        
        <p>Please log in to the maintenance management system to view full details and update the status:</p>
        
        <div style="text-align: center; margin: 30px 0;">
          <a href="${Deno.env.get('SUPABASE_URL')?.replace('.supabase.co', '.lovableproject.com') || 'https://your-app-domain.com'}" 
             style="background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
            Access Maintenance System
          </a>
        </div>
        
        <p style="color: #666; font-size: 14px;">
          If you have any questions, please contact your supervisor.
        </p>
        
        <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;">
        <p style="color: #999; font-size: 12px; text-align: center;">
          <strong>HotelCare.app</strong> - Hotel Operations Management<br>
          This is an automated notification.
        </p>
      </div>
    `;

    // Send email using Resend
    const emailResponse = await resend.emails.send({
      from: 'HotelCare.app <noreply@hotelcare.app>',
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