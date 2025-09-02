import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "npm:resend@2.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Allowed email domains for security
const ALLOWED_EMAIL_DOMAINS = [
  'gmail.com',
  'hotmail.com',
  'outlook.com',
  'yahoo.com',
  // Add your company domain here
  // 'yourcompany.com'
];

function validateEmailDomain(email: string): boolean {
  const domain = email.split('@')[1]?.toLowerCase();
  return ALLOWED_EMAIL_DOMAINS.includes(domain);
}

interface EmailRequest {
  to: string;
  ticketNumber: string;
  ticketTitle: string;
  ticketId: string;
  hotel: string;
  assignedBy: string;
  priority?: string;
  description?: string;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Parse and validate request body
    const body: EmailRequest = await req.json();
    const { to, ticketNumber, ticketTitle, ticketId, hotel, assignedBy, priority, description } = body;

    // Input validation
    if (!to || !ticketNumber || !ticketTitle || !ticketId || !hotel || !assignedBy) {
      throw new Error('Missing required fields');
    }

    if (typeof to !== 'string' || !to.includes('@')) {
      throw new Error('Invalid email format');
    }

    if (!validateEmailDomain(to)) {
      throw new Error('Email domain not allowed');
    }

    // Validate priority if provided
    if (priority) {
      const validPriorities = ['low', 'medium', 'high', 'urgent'];
      if (!validPriorities.includes(priority)) {
        throw new Error('Invalid priority value');
      }
    }

    console.log('Received notification request:', { ticketId, to, ticketNumber, priority });

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
            ${priority ? `<p><strong>Priority:</strong> <span style="color: ${priority === 'urgent' ? '#dc2626' : priority === 'high' ? '#ea580c' : priority === 'medium' ? '#d97706' : '#65a30d'}">${priority.toUpperCase()}</span></p>` : ''}
            ${description ? `<p><strong>Description:</strong> ${description}</p>` : ''}
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