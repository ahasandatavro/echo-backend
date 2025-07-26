import agenda from '../config/agenda';
import { prisma } from '../models/prismaClient';

interface WaitingMessageJobData {
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
    const durationMinutes = parseInt(process.env.WAITING_MESSAGE_DURATION_MINUTES || '10');
    const scheduleTime = new Date(Date.now() + durationMinutes * 60 * 1000);
    
    const jobData: WaitingMessageJobData = {
      conversationId,
      recipient,
      agentPhoneNumberId
    };

    const job = await agenda.schedule(scheduleTime, 'waiting-message-job', jobData);
    
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
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { waitingJobId: true, waitingMessageSent: true }
    });

    if (conversation?.waitingJobId) {
      await cancelWaitingMessageJob(conversation.waitingJobId);
    }

    const newJobId = await scheduleWaitingMessageJob(conversationId, recipient, agentPhoneNumberId);

    if (newJobId) {
      await prisma.conversation.update({
        where: { id: conversationId },
        data: {
          waitingJobId: newJobId,
          waitingMessageSent: false
        }
      });
    } else {
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