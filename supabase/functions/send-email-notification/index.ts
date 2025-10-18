import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "npm:resend@2.0.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Allowed email domains for security
const allowedDomains = [
  'gmail.com',
  'outlook.com',
  'hotmail.com',
  'yahoo.com',
  'company.com', // Add your company domain here
  'rdhotels.com' // Add specific hotel domains
];

function validateEmailDomain(email: string): boolean {
  const domain = email.split('@')[1]?.toLowerCase();
  return allowedDomains.includes(domain);
}

interface EmailRequest {
  to: string;
  ticketId: string;
  ticketNumber: string;
  ticketTitle: string;
  hotel: string;
  assignedBy: string;
  priority?: string;
  description?: string;
}

const handler = async (req: Request): Promise<Response> => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const resendApiKey = Deno.env.get('RESEND_API_KEY');
    if (!resendApiKey) {
      throw new Error('RESEND_API_KEY is not configured');
    }

    const resend = new Resend(resendApiKey);
    
    const { to, ticketId, ticketNumber, ticketTitle, hotel, assignedBy, priority, description }: EmailRequest = await req.json();

    // Validate required fields
    if (!to || !ticketId || !ticketNumber || !ticketTitle || !hotel || !assignedBy) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: to, ticketId, ticketNumber, ticketTitle, hotel, assignedBy' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(to)) {
      return new Response(
        JSON.stringify({ error: 'Invalid email format' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Validate email domain for security
    if (!validateEmailDomain(to)) {
      console.log(`Email domain not allowed: ${to.split('@')[1]}`);
      return new Response(
        JSON.stringify({ error: 'Email domain not allowed' }),
        {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Validate priority if provided
    if (priority) {
      const validPriorities = ['low', 'medium', 'high', 'urgent'];
      if (!validPriorities.includes(priority)) {
        return new Response(
          JSON.stringify({ error: 'Invalid priority value' }),
          {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }
    }

    // Sanitize inputs to prevent injection
    const sanitizedTitle = ticketTitle.replace(/<[^>]*>/g, '').substring(0, 200);
    const sanitizedHotel = hotel.replace(/<[^>]*>/g, '').substring(0, 100);
    const sanitizedAssignedBy = assignedBy.replace(/<[^>]*>/g, '').substring(0, 100);
    const sanitizedDescription = description ? description.replace(/<[^>]*>/g, '').substring(0, 500) : '';

    console.log(`Sending email notification for ticket: ${ticketNumber}`);

    const emailHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px;">
          <div style="text-align: center; margin-bottom: 20px;">
            <img src="https://rdhotels-management.lovable.app/logo.png" alt="HotelCare.app" style="height: 60px; width: auto;">
          </div>
          
          <h2 style="color: #007bff; margin-bottom: 20px;">🎟️ New Ticket Assignment - ${ticketNumber}</h2>
          
          <div style="background-color: white; padding: 20px; border-radius: 6px; margin-bottom: 20px;">
            <h3 style="color: #333; margin-top: 0;">${sanitizedTitle}</h3>
            
            <div style="margin-bottom: 15px;">
              <strong>Hotel:</strong> ${sanitizedHotel}<br>
              <strong>Assigned by:</strong> ${sanitizedAssignedBy}<br>
              ${priority ? `<strong>Priority:</strong> <span style="color: ${priority === 'urgent' ? '#dc3545' : priority === 'high' ? '#fd7e14' : priority === 'medium' ? '#ffc107' : '#28a745'};">${priority.toUpperCase()}</span><br>` : ''}
              ${sanitizedDescription ? `<strong>Description:</strong> ${sanitizedDescription}` : ''}
            </div>
          </div>
          
          <div style="text-align: center; margin-top: 30px;">
            <a href="https://rdhotels-management.lovable.app/" 
               style="background-color: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
              View Dashboard
            </a>
          </div>
          
          <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #dee2e6; text-align: center; color: #6c757d; font-size: 12px;">
            <strong>HotelCare.app</strong> - Hotel Operations Management<br>
            This is an automated notification
          </div>
        </div>
      </div>
    `;

    const result = await resend.emails.send({
      from: "HotelCare.app <notifications@resend.dev>",
      to: [to],
      subject: `🎟️ New Ticket Assignment: ${ticketNumber} - ${sanitizedTitle}`,
      html: emailHtml,
    });

    console.log('Email sent successfully');

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders,
      },
    });
  } catch (error: any) {
    console.error('Error in send-email-notification function:', error);
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