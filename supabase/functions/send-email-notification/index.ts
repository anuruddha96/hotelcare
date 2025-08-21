import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "npm:resend@2.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface EmailRequest {
  to: string;
  ticketNumber: string;
  ticketTitle: string;
  ticketId: string;
  hotel: string;
  assignedBy: string;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { to, ticketNumber, ticketTitle, ticketId, hotel, assignedBy }: EmailRequest = await req.json();

    const loginUrl = `${Deno.env.get('SUPABASE_URL')}/auth/v1/magiclink?token=${ticketId}&redirect_to=${encodeURIComponent(`${Deno.env.get('SITE_URL')}/?ticket=${ticketId}`)}`;

    const emailResponse = await resend.emails.send({
      from: "RD Hotels <onboarding@resend.dev>",
      to: [to],
      subject: `New Ticket Assigned: ${ticketNumber}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #333;">New Ticket Assignment</h1>
          <p>Hello,</p>
          
          <p>You have been assigned a new service request ticket:</p>
          
          <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <h3>Ticket Details:</h3>
            <p><strong>Ticket Number:</strong> ${ticketNumber}</p>
            <p><strong>Title:</strong> ${ticketTitle}</p>
            <p><strong>Hotel:</strong> ${hotel}</p>
            <p><strong>Assigned by:</strong> ${assignedBy}</p>
          </div>
          
          <p>Click the button below to view and manage this ticket:</p>
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="${loginUrl}" 
               style="background-color: #007bff; color: white; padding: 12px 24px; 
                      text-decoration: none; border-radius: 5px; display: inline-block;">
              View Ticket
            </a>
          </div>
          
          <p style="font-size: 12px; color: #666;">
            This is an automated message from RD Hotels Management System.
          </p>
        </div>
      `,
    });

    console.log("Email sent successfully:", emailResponse);

    return new Response(JSON.stringify(emailResponse), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders,
      },
    });
  } catch (error: any) {
    console.error("Error sending email:", error);
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