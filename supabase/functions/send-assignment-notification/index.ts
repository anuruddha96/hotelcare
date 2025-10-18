import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "npm:resend@2.0.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.53.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface AssignmentNotificationRequest {
  staffId: string;
  staffName: string;
  assignmentDate: string;
  roomNumbers: string;
  assignmentType: string;
  totalRooms: number;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const {
      staffId,
      staffName,
      assignmentDate,
      roomNumbers,
      assignmentType,
      totalRooms
    }: AssignmentNotificationRequest = await req.json();

    // Initialize Supabase client
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Get staff email
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('email')
      .eq('id', staffId)
      .single();

    if (profileError) {
      console.error('Error fetching staff profile:', profileError);
      throw new Error('Failed to fetch staff profile');
    }

    const loginUrl = `${Deno.env.get('SUPABASE_URL')}/auth/v1/authorize?provider=email`;
    
    const formatAssignmentType = (type: string) => {
      switch (type) {
        case 'daily_cleaning':
          return 'Daily Cleaning';
        case 'checkout_cleaning':
          return 'Checkout Cleaning';
        case 'deep_cleaning':
          return 'Deep Cleaning';
        case 'maintenance':
          return 'Maintenance';
        default:
          return type;
      }
    };

    const emailHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="text-align: center; margin-bottom: 20px;">
          <img src="https://rdhotels-management.lovable.app/logo.png" alt="HotelCare.app" style="height: 60px; width: auto;">
        </div>
        
        <h2 style="color: #2563eb;">New Room Assignment</h2>
        
        <p>Hello ${staffName},</p>
        
        <p>You have been assigned new rooms for <strong>${new Date(assignmentDate).toLocaleDateString()}</strong>.</p>
        
        <div style="background-color: #f8fafc; padding: 16px; border-radius: 8px; margin: 20px 0;">
          <h3 style="margin-top: 0; color: #1e40af;">Assignment Details</h3>
          <p><strong>Type:</strong> ${formatAssignmentType(assignmentType)}</p>
          <p><strong>Total Rooms:</strong> ${totalRooms}</p>
          <p><strong>Rooms:</strong> ${roomNumbers}</p>
          <p><strong>Date:</strong> ${new Date(assignmentDate).toLocaleDateString()}</p>
        </div>
        
        <p>Please log in to your account to view detailed assignment information and manage your tasks.</p>
        
        <div style="text-align: center; margin: 30px 0;">
          <a href="${loginUrl}" 
             style="background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
            Log In to View Assignments
          </a>
        </div>
        
        <p style="color: #64748b; font-size: 14px;">
          If you have any questions about your assignments, please contact your manager.
        </p>
        
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">
        
        <p style="color: #9ca3af; font-size: 12px; text-align: center;">
          <strong>HotelCare.app</strong> - Hotel Operations Management<br>
          This is an automated notification
        </p>
      </div>
    `;

    const emailResponse = await resend.emails.send({
      from: "HotelCare.app <onboarding@resend.dev>",
      to: [profile.email],
      subject: `New Room Assignment - ${totalRooms} rooms for ${new Date(assignmentDate).toLocaleDateString()}`,
      html: emailHtml,
    });

    console.log("Assignment notification sent successfully:", emailResponse);

    return new Response(JSON.stringify(emailResponse), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders,
      },
    });
  } catch (error: any) {
    console.error("Error in send-assignment-notification function:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
};

serve(handler);