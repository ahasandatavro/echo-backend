import { Agenda, Job } from '@hokify/agenda';
import { brodcastTemplate } from '../processors/template/templateProcessor';
import { prisma } from '../models/prismaClient';
import { syncTemplates } from '../services/templateService';
import { registerChatbotTimerJobs } from '../utils/chatbotTimerUtils';
import { processWaitingMessageJob } from '../jobs/waitingMessageJob';

if (!process.env.MONGODB_URI) {
  throw new Error('MONGODB_URI environment variable is not set. Please add it to your .env file.');
}

const agenda = new Agenda({
  db: {
    address: process.env.MONGODB_URI,
    collection: 'agendaJobs'
  },
  processEvery: '30 seconds',
  maxConcurrency: 20,
  defaultConcurrency: 5,
  lockLimit: 0,
  defaultLockLimit: 0,
  defaultLockLifetime: 10 * 60 * 1000 // 10 minutes
});

agenda.on('error', (err) => {
  console.error('Agenda connection error:', err);
});

// Define the data structure
interface SendScheduledBroadcastData {
  broadcastId: number;
}

// Define job processor
agenda.define<SendScheduledBroadcastData>('sendScheduledBroadcast', async (job: Job<SendScheduledBroadcastData>) => {
  try {
    const { broadcastId } = job.attrs.data;

    const broadcast = await prisma.broadcast.findUnique({
      where: { id: broadcastId },
      include: {
        recipients: {
          include: { contact: true }
        }
      }
    });

    if (!broadcast) {
      throw new Error(`Broadcast ${broadcastId} not found`);
    }

    for (const recipient of broadcast.recipients) {
      await brodcastTemplate(
        recipient.contact.phoneNumber,
        broadcast.templateName,
        0,
        broadcast.id,
        broadcast?.phoneNumberId || undefined
      );
    }

    await prisma.broadcast.update({
      where: { id: broadcastId },
      data: {
        sentAt: new Date(),
        status: 'SENT'
      }
    });

  } catch (error) {
    console.error('Error processing scheduled broadcast:', error);
    await prisma.broadcast.update({
      where: { id: job.attrs.data.broadcastId },
      data: {
        status: 'FAILED'
      }
    });
  }
});

// Define waiting message job processor
console.log('📋 Registering waiting-message-job processor');
agenda.define('waiting-message-job', processWaitingMessageJob);
console.log('✅ waiting-message-job processor registered successfully');

// agenda.define('syncMetaTemplates', async (job: Job) => {
//   try {
//     await syncTemplates()
//     console.log('✅ Meta templates synced')
//   } catch (e) {
//     console.error('❌ syncMetaTemplates failed:', e)
//   }
// })

export const initializeAgenda = async () => {
  try {
    console.log('🚀 Starting Agenda...');
    await agenda.start();
    console.log('✅ Agenda started successfully');
    
    registerChatbotTimerJobs();
    console.log('✅ Chatbot timer jobs registered');
    
    // Check if waiting-message-job is properly registered
    const definedJobs = (agenda as any)._definitions;
    if (definedJobs) {
      console.log('📋 Defined jobs:', Object.keys(definedJobs));
      console.log('🔍 waiting-message-job defined:', !!definedJobs['waiting-message-job']);
    } else {
      console.log('⚠️ Agenda definitions not available yet');
    }
    
    //make 1 minute interval
    //await agenda.every('1 minute', 'syncMetaTemplates');
    //await agenda.now('syncMetaTemplates');
  } catch (error) {
    console.error('❌ Failed to start Agenda:', error);
    throw error;
  }
};

export default agenda;
