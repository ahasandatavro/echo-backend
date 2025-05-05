import sgMail from '@sendgrid/mail';
import { welcomeEmailTemplate, resetPasswordEmailTemplate } from '../templates/emailTemplates';
import crypto from 'crypto';

// Initialize SendGrid with API key
sgMail.setApiKey(process.env.SENDGRID_API_KEY || '');

export const generateVerificationToken = () => {
  return crypto.randomBytes(32).toString('hex');
};

export const sendWelcomeEmail = async (email: string, firstName: string, verificationToken: string) => {
  const verificationLink = `${process.env.FRONTEND_URL}/#/verify-email?token=${verificationToken}`;

  const msg = {
    to: email,
    from: process.env.SENDGRID_FROM_EMAIL || 'noreply@zilochat.io',
    subject: 'Welcome to ZiloChat!',
    html: welcomeEmailTemplate(firstName, verificationLink),
  };

  try {
    await sgMail.send(msg);
    console.log('Welcome email sent successfully');
  } catch (error) {
    console.error('Error sending welcome email:', error);
    throw error;
  }
};

export const sendPasswordResetEmail = async (email: string, firstName: string, resetToken: string) => {
  const resetLink = `${process.env.FRONTEND_URL}/#/reset-password?token=${resetToken}`;

  const msg = {
    to: email,
    from: process.env.SENDGRID_FROM_EMAIL || 'noreply@zilochat.io',
    subject: 'Reset Your ZiloChat Password',
    html: resetPasswordEmailTemplate(firstName, resetLink),
  };

  try {
    await sgMail.send(msg);
    console.log('Password reset email sent successfully');
  } catch (error) {
    console.error('Error sending password reset email:', error);
    throw error;
  }
};
