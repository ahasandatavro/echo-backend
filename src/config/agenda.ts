import Agenda from 'agenda';
import { brodcastTemplate } from '../processors/template/templateProcessor';
import { prisma } from '../models/prismaClient';
import { Job } from 'agenda';

// Create agenda instance with proper MongoDB connection
const agenda = new Agenda({
  db: { 
    address: process.env.MONGODB_URI || 'mongodb://localhost:27017/agenda',
    collection: 'agendaJobs'
  },
  processEvery: '30 seconds'
});

// Handle MongoDB connection errors
agenda.on('error', (err) => {
  console.error('Agenda connection error:', err);
});

// Define job processor for scheduled broadcasts
agenda.define('sendScheduledBroadcast', async (job: Job) => {
  try {
    const { broadcastId } = job.attrs.data;
    
    // Get broadcast details
    const broadcast = await prisma.broadcast.findUnique({
      where: { id: broadcastId },
      include: {
        recipients: {
          include: {
            contact: true
          }
        }
      }
    });

    if (!broadcast) {
      throw new Error(`Broadcast ${broadcastId} not found`);
    }

    // Send broadcast to all recipients
    for (const recipient of broadcast.recipients) {
      await brodcastTemplate(
        recipient.contact.phoneNumber,
        broadcast.templateName,
        0, // chatbotId is optional, using 0 as default
        broadcast.id
      );
    }

    // Update broadcast sent time and status
    await prisma.broadcast.update({
      where: { id: broadcastId },
      data: {
        sentAt: new Date(),
        status: 'SENT'
      }
    });

  } catch (error) {
    console.error('Error processing scheduled broadcast:', error);
    // Update status to FAILED
    await prisma.broadcast.update({
      where: { id: job.attrs.data.broadcastId },
      data: {
        status: 'FAILED'
      }
    });
  }
});

// Start agenda with error handling
(async function() {
  try {
    await agenda.start();
    console.log('Agenda started successfully');
  } catch (error) {
    console.error('Failed to start Agenda:', error);
  }
})();

export default agenda;
