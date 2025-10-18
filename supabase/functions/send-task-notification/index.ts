import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.53.0";
import { Resend } from "npm:resend@4.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

interface TaskNotificationRequest {
  userId: string;
  type: 'assignment' | 'ticket_update' | 'ticket_assigned' | 'break_request_update';
  title: string;
  message: string;
  roomNumber?: string;
  ticketNumber?: string;
  priority?: string;
  assignmentType?: string;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { 
      userId, 
      type, 
      title, 
      message, 
      roomNumber, 
      ticketNumber, 
      priority,
      assignmentType 
    }: TaskNotificationRequest = await req.json();

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Get user details
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('email, full_name, preferred_language')
      .eq('id', userId)
      .single();

    if (profileError || !profile) {
      console.log('User not found or has no email:', userId);
      return new Response(JSON.stringify({ 
        success: false, 
        message: "User not found or no email address" 
      }), {
        status: 404,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // Skip if email is a dummy/system email
    if (!profile.email || profile.email.includes('@rdhotels.local') || !profile.email.includes('@')) {
      console.log('Skipping notification for system/dummy email:', profile.email);
      return new Response(JSON.stringify({ 
        success: true, 
        message: "Skipped notification for system email" 
      }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // Get notification icon and color based on type
    const getNotificationStyle = (type: string, priority?: string) => {
      switch (type) {
        case 'assignment':
          return { icon: '🏨', color: '#2563eb', bgColor: '#dbeafe' };
        case 'ticket_update':
          const ticketColor = priority === 'urgent' ? '#dc2626' : priority === 'high' ? '#ea580c' : '#2563eb';
          return { icon: '🎫', color: ticketColor, bgColor: priority === 'urgent' ? '#fecaca' : priority === 'high' ? '#fed7aa' : '#dbeafe' };
        case 'ticket_assigned':
          return { icon: '📋', color: '#2563eb', bgColor: '#dbeafe' };
        case 'break_request_update':
          return { icon: '⏸️', color: '#059669', bgColor: '#d1fae5' };
        default:
          return { icon: '📱', color: '#2563eb', bgColor: '#dbeafe' };
      }
    };

    const style = getNotificationStyle(type, priority);
    const appUrl = Deno.env.get("SITE_URL") || "http://localhost:3000";

    // Create email HTML
    const emailHtml = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${title} - HotelCare.app</title>
        <style>
          body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 0; padding: 0; background-color: #f5f5f5; }
          .container { max-width: 600px; margin: 40px auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.1); }
          .header { background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%); padding: 30px 30px 20px; text-align: center; }
          .logo { height: 60px; width: auto; margin-bottom: 10px; }
          .subtitle { color: rgba(255,255,255,0.9); font-size: 16px; }
          .content { padding: 40px 30px; }
          .notification-badge { display: inline-block; background: ${style.bgColor}; color: ${style.color}; padding: 8px 16px; border-radius: 20px; font-size: 14px; font-weight: 600; margin-bottom: 20px; }
          .greeting { font-size: 18px; color: #1f2937; margin-bottom: 20px; }
          .message { color: #4b5563; line-height: 1.6; margin-bottom: 30px; font-size: 16px; }
          .details-box { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; margin: 20px 0; }
          .detail-item { display: flex; justify-content: space-between; margin-bottom: 10px; }
          .detail-label { font-weight: 600; color: #374151; }
          .detail-value { color: #6b7280; }
          .action-button { display: inline-block; background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%); color: white; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 600; text-align: center; margin: 20px 0; }
          .footer { background: #f9fafb; padding: 30px; text-align: center; border-top: 1px solid #e5e7eb; }
          .footer-text { color: #6b7280; font-size: 14px; line-height: 1.5; }
          .priority-urgent { border-left: 4px solid #dc2626; }
          .priority-high { border-left: 4px solid #ea580c; }
          .priority-medium { border-left: 4px solid #2563eb; }
          .priority-low { border-left: 4px solid #059669; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <img src="https://rdhotels-management.lovable.app/logo.png" alt="HotelCare.app" class="logo">
            <div class="subtitle">Hotel Operations Management</div>
          </div>
          
          <div class="content">
            <div class="notification-badge">
              ${style.icon} ${type.replace('_', ' ').toUpperCase()}
            </div>
            
            <div class="greeting">Hello ${profile.full_name || 'Team Member'},</div>
            
            <div class="message">
              ${message}
            </div>
            
            ${roomNumber || ticketNumber || assignmentType || priority ? `
            <div class="details-box ${priority ? `priority-${priority}` : ''}">
              <h4 style="margin-top: 0; color: #374151;">Details</h4>
              ${roomNumber ? `
              <div class="detail-item">
                <span class="detail-label">Room Number:</span>
                <span class="detail-value">${roomNumber}</span>
              </div>
              ` : ''}
              ${ticketNumber ? `
              <div class="detail-item">
                <span class="detail-label">Ticket Number:</span>
                <span class="detail-value">${ticketNumber}</span>
              </div>
              ` : ''}
              ${assignmentType ? `
              <div class="detail-item">
                <span class="detail-label">Assignment Type:</span>
                <span class="detail-value">${assignmentType.replace('_', ' ').toUpperCase()}</span>
              </div>
              ` : ''}
              ${priority ? `
              <div class="detail-item">
                <span class="detail-label">Priority:</span>
                <span class="detail-value" style="color: ${style.color}; font-weight: 600;">${priority.toUpperCase()}</span>
              </div>
              ` : ''}
            </div>
            ` : ''}
            
            <div style="text-align: center;">
              <a href="${appUrl}" class="action-button">Open RD Hotels App</a>
            </div>
            
            <div class="message" style="font-size: 14px; color: #6b7280;">
              Please log in to the HotelCare.app management system to view full details and take action.
            </div>
          </div>
          
          <div class="footer">
            <div class="footer-text">
              <strong>HotelCare.app</strong> - Hotel Operations Management<br>
              This is an automated notification. Please do not reply to this email.<br>
              If you need assistance, contact your system administrator.
            </div>
          </div>
        </div>
      </body>
      </html>
    `;

    // Send email
    const { error: emailError } = await resend.emails.send({
      from: "HotelCare.app <notifications@hotelcare.app>",
      to: [profile.email],
      subject: `${title} - HotelCare.app`,
      html: emailHtml,
    });

    if (emailError) {
      console.error('Email sending error:', emailError);
      return new Response(JSON.stringify({ error: "Failed to send notification email" }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: "Notification email sent successfully" 
      }),
      { 
        status: 200, 
        headers: { "Content-Type": "application/json", ...corsHeaders } 
      }
    );

  } catch (error: any) {
    console.error("Task notification function error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
};

serve(handler);