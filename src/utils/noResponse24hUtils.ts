import agenda from '../config/agenda';
import { prisma } from '../models/prismaClient';

interface NoResponse24hJobData {
  conversationId: number;
  recipient: string;
  agentPhoneNumberId: string | undefined;
}

export const schedule24hNoResponseJob = async (
  conversationId: number,
  recipient: string,
  agentPhoneNumberId: string | undefined
): Promise<string | null> => {
  try {
    const durationMinutes = parseInt(process.env.NO_RESPONSE_24H_DURATION_MINUTES || '1440');
    const scheduleTime = new Date(Date.now() + durationMinutes * 60 * 1000);

    const jobData: NoResponse24hJobData = {
      conversationId,
      recipient,
      agentPhoneNumberId
    };

    const job = await agenda.schedule(scheduleTime, 'no-response-24h-job', jobData);
    return job.attrs._id?.toString() || null;
  } catch (error) {
    console.error('Error scheduling 24h no response job:', error);
    return null;
  }
};

export const cancel24hNoResponseJob = async (jobId: string): Promise<boolean> => {
  try {
    console.log(`🔍 Attempting to cancel 24h job with ID: ${jobId}`);
    
    // Try multiple approaches to cancel the job
    let numRemoved = 0;
    
    // Method 1: Cancel by _id as ObjectId
    try {
      const { ObjectId } = require('mongodb');
      numRemoved = await agenda.cancel({ _id: new ObjectId(jobId) });
      console.log(`📊 Method 1 (ObjectId): Cancelled ${numRemoved} job(s)`);
    } catch (objectIdError) {
      console.log(`⚠️ Method 1 failed:`, (objectIdError as Error).message);
    }
    
    // Method 2: Cancel by _id as string (if method 1 failed)
    if (numRemoved === 0) {
      try {
        numRemoved = await agenda.cancel({ _id: jobId as any });
        console.log(`📊 Method 2 (String): Cancelled ${numRemoved} job(s)`);
      } catch (stringError) {
        console.log(`⚠️ Method 2 failed:`, (stringError as Error).message);
      }
    }
    
    console.log(`🗑️ Total cancelled 24h no response job(s): ${numRemoved} with ID: ${jobId}`);
    return numRemoved > 0;
  } catch (error) {
    console.error('❌ Error cancelling 24h no response job:', error);
    return false;
  }
};

export const reschedule24hJobForConversation = async (
  conversationId: number,
  recipient: string,
  agentPhoneNumberId: string | undefined
): Promise<void> => {
  try {
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { noResponse24hJobId: true, noResponse24hSent: true }
    });

    if (conversation?.noResponse24hJobId) {
      await cancel24hNoResponseJob(conversation.noResponse24hJobId);
    }

    const newJobId = await schedule24hNoResponseJob(conversationId, recipient, agentPhoneNumberId);

    if (newJobId) {
      await prisma.conversation.update({
        where: { id: conversationId },
        data: {
          noResponse24hJobId: newJobId,
          noResponse24hSent: false,
          lastCustomerMessageAt: null
        }
      });
    }
  } catch (error) {
    console.error('Error in reschedule24hJobForConversation:', error);
  }
};

export const updateCustomerMessageTimestamp = async (conversationId: number): Promise<void> => {
  try {
    await prisma.conversation.update({
      where: { id: conversationId },
      data: {
        lastCustomerMessageAt: new Date()
      }
    });
  } catch (error) {
    console.error('Error updating customer message timestamp:', error);
  }
};

export const cancel24hJobForConversation = async (conversationId: number): Promise<void> => {
  try {
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { noResponse24hJobId: true }
    });

    if (conversation?.noResponse24hJobId) {
      await cancel24hNoResponseJob(conversation.noResponse24hJobId);

      await prisma.conversation.update({
        where: { id: conversationId },
        data: {
          noResponse24hJobId: null,
          noResponse24hSent: false
        }
      });
    }
  } catch (error) {
    console.error('Error cancelling 24h job for conversation:', error);
  }
}; 