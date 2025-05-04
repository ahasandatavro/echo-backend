import sgMail from '@sendgrid/mail';
import { welcomeEmailTemplate } from '../templates/emailTemplates';

// Initialize SendGrid with API key
sgMail.setApiKey(process.env.SENDGRID_API_KEY || '');

export const sendWelcomeEmail = async (email: string, firstName: string) => {
  const msg = {
    to: email,
    from: process.env.SENDGRID_FROM_EMAIL || 'noreply@zilochat.io', // Replace with your verified sender email
    subject: 'Welcome to ZiloChat!',
    html: welcomeEmailTemplate(firstName),
  };

  try {
    await sgMail.send(msg);
    console.log('Welcome email sent successfully');
  } catch (error) {
    console.error('Error sending welcome email:', error);
    throw error;
  }
}; 