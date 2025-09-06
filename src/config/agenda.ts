import { Agenda, Job } from '@hokify/agenda';
import { broadcastTemplate } from '../controllers/templateController';
import { prisma } from '../models/prismaClient';
import { syncTemplates } from '../services/templateService';
import { registerChatbotTimerJobs } from '../utils/chatbotTimerUtils';
import { processWaitingMessageJob } from '../jobs/waitingMessageJob';
import { processNoResponse24hJob } from '../jobs/noResponse24hJob';

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
  templateParameters?: Record<string, string>;
  fileUrl?: string;
}

// Define job processor
agenda.define<SendScheduledBroadcastData>('sendScheduledBroadcast', async (job: Job<SendScheduledBroadcastData>) => {
  try {
    const { broadcastId, templateParameters, fileUrl } = job.attrs.data;

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
      await broadcastTemplate(
        recipient.contact.phoneNumber,
        broadcast.templateName,
        0,
        broadcast.id,
        broadcast?.phoneNumberId || undefined,
        templateParameters,
        fileUrl
      );
    }

    // Update broadcast status only if it still exists and hasn't been updated by webhooks
    const updatedBroadcast = await prisma.broadcast.updateMany({
      where: {
        id: broadcastId,
        status: { in: ['SCHEDULED', 'PENDING'] } // Only update if still in initial state
      },
      data: {
        sentAt: new Date(),
        status: 'SENT'
      }
    });

    if (updatedBroadcast.count === 0) {
      console.log(`Broadcast ${broadcastId} was already updated by webhook processing`);
    }

  } catch (error) {
    console.error('Error processing scheduled broadcast:', error);

    // Only update to FAILED if the broadcast still exists and hasn't been processed
    const failedUpdate = await prisma.broadcast.updateMany({
      where: {
        id: job.attrs.data.broadcastId,
        status: { in: ['SCHEDULED', 'PENDING'] }
      },
      data: {
        status: 'FAILED'
      }
    });

    if (failedUpdate.count === 0) {
      console.log(`Broadcast ${job.attrs.data.broadcastId} was already processed or doesn't exist`);
    }
  }
});

agenda.define('waiting-message-job', processWaitingMessageJob);
agenda.define('no-response-24h-job', processNoResponse24hJob);

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
    await agenda.start();
    registerChatbotTimerJobs();
  } catch (error) {
    console.error('Failed to start Agenda:', error);
    throw error;
  }
};

export default agenda;
