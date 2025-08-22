import agenda from '../config/agenda';
import { prisma } from '../models/prismaClient';

// Log environment variable when module is loaded
console.log(`🔧 WAITING_MESSAGE_DURATION_MINUTES module loaded:`);
console.log(`   - Raw env value: "${process.env.WAITING_MESSAGE_DURATION_MINUTES}"`);
console.log(`   - Parsed value: ${parseInt(process.env.WAITING_MESSAGE_DURATION_MINUTES || '10')} minutes`);
console.log(`   - Fallback used: ${!process.env.WAITING_MESSAGE_DURATION_MINUTES ? 'YES (default: 10 minutes)' : 'NO'}`);

export interface WaitingMessageJobData {
  conversationId: number;
  recipient: string;
  agentPhoneNumberId: string | undefined;
}

export const scheduleWaitingMessageJob = async (
  conversationId: number,
  recipient: string,
  agentPhoneNumberId: string | undefined
): Promise<string | null> => {
  try {
    // Log environment variable usage
    const rawDuration = process.env.WAITING_MESSAGE_DURATION_MINUTES;
    const durationMinutes = parseInt(rawDuration || '10');
    const scheduleTime = new Date(Date.now() + durationMinutes * 60 * 1000);
    
    console.log(`⏰ WAITING_MESSAGE_DURATION_MINUTES usage:`);
    console.log(`   - Raw env value: "${rawDuration}"`);
    console.log(`   - Parsed minutes: ${durationMinutes}`);
    console.log(`   - Current time: ${new Date().toISOString()}`);
    console.log(`   - Schedule time: ${scheduleTime.toISOString()}`);
    console.log(`   - Duration in ms: ${durationMinutes * 60 * 1000}`);
    console.log(`   - Fallback used: ${!rawDuration ? 'YES (default: 10 minutes)' : 'NO'}`);
    
    const jobData: WaitingMessageJobData = {
      conversationId,
      recipient,
      agentPhoneNumberId
    };

    const job = await agenda.schedule(scheduleTime, 'waiting-message-job', jobData);
    
    console.log(`✅ Waiting message job scheduled:`);
    console.log(`   - Job ID: ${job.attrs._id}`);
    console.log(`   - Conversation ID: ${conversationId}`);
    console.log(`   - Recipient: ${recipient}`);
    console.log(`   - Will execute in: ${durationMinutes} minutes`);
    
    return job.attrs._id?.toString() || null;
  } catch (error) {
    console.error('Error scheduling waiting message job:', error);
    return null;
  }
};

export const cancelWaitingMessageJob = async (jobId: string): Promise<boolean> => {
  try {
    let numRemoved = 0;
    
    // Try ObjectId format first
    try {
      const { ObjectId } = require('mongodb');
      numRemoved = await agenda.cancel({ _id: new ObjectId(jobId) });
    } catch (objectIdError) {
      // Fallback to string format
      numRemoved = await agenda.cancel({ _id: jobId as any });
    }
    
    return numRemoved > 0;
  } catch (error) {
    console.error('Error cancelling waiting message job:', error);
    return false;
  }
};

export const cancelAndRescheduleWaitingMessage = async (
  conversationId: number,
  recipient: string,
  agentPhoneNumberId: string | undefined
): Promise<void> => {
  try {
    console.log(`🔄 Cancelling and rescheduling waiting message for conversation: ${conversationId}`);
    
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { waitingJobId: true, waitingMessageSent: true }
    });

    if (conversation?.waitingJobId) {
      console.log(`   - Cancelling existing job: ${conversation.waitingJobId}`);
      await cancelWaitingMessageJob(conversation.waitingJobId);
    } else {
      console.log(`   - No existing job to cancel`);
    }

    console.log(`   - Scheduling new waiting message job...`);
    const newJobId = await scheduleWaitingMessageJob(conversationId, recipient, agentPhoneNumberId);

    if (newJobId) {
      console.log(`   - New job scheduled successfully: ${newJobId}`);
      await prisma.conversation.update({
        where: { id: conversationId },
        data: {
          waitingJobId: newJobId,
          waitingMessageSent: false
        }
      });
    } else {
      console.log(`   - Failed to schedule new job`);
      await prisma.conversation.update({
        where: { id: conversationId },
        data: {
          waitingJobId: null,
          waitingMessageSent: false
        }
      });
    }
  } catch (error) {
    console.error('Error in cancelAndRescheduleWaitingMessage:', error);
  }
};

export const cancelWaitingMessageForConversation = async (conversationId: number): Promise<void> => {
  try {
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { waitingJobId: true }
    });

    if (conversation?.waitingJobId) {
      await cancelWaitingMessageJob(conversation.waitingJobId);

      await prisma.conversation.update({
        where: { id: conversationId },
        data: {
          waitingJobId: null,
          waitingMessageSent: false
        }
      });
    }
  } catch (error) {
    console.error('Error cancelling waiting message for conversation:', error);
  }
}; 