import agenda from '../config/agenda';
import { prisma } from '../models/prismaClient';

// Log environment variable on module load
console.log(`🔧 WAITING_MESSAGE_DURATION_MINUTES environment variable: ${process.env.WAITING_MESSAGE_DURATION_MINUTES || 'NOT SET (using default: 10)'}`);

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
    
    console.log(`📅 scheduleWaitingMessageJob called:`);
    console.log(`   - conversationId: ${conversationId}`);
    console.log(`   - recipient: ${recipient}`);
    console.log(`   - agentPhoneNumberId: ${agentPhoneNumberId}`);
    console.log(`   - durationMinutes: ${durationMinutes}`);
    console.log(`   - scheduleTime: ${scheduleTime.toISOString()}`);
    
    const jobData: WaitingMessageJobData = {
      conversationId,
      recipient,
      agentPhoneNumberId
    };

    console.log(`🚀 Calling agenda.schedule with jobData:`, jobData);
    const job = await agenda.schedule(scheduleTime, 'waiting-message-job', jobData);
    console.log(`✅ Job scheduled successfully. Job ID: ${job.attrs._id?.toString()}`);
    console.log(`📋 Job details:`, {
      id: job.attrs._id?.toString(),
      name: job.attrs.name,
      data: job.attrs.data,
      nextRunAt: job.attrs.nextRunAt
    });
    
    return job.attrs._id?.toString() || null;
  } catch (error) {
    console.error('❌ Error scheduling waiting message job:', error);
    console.error('Error stack:', (error as Error).stack);
    return null;
  }
};

export const cancelWaitingMessageJob = async (jobId: string): Promise<boolean> => {
  try {
    console.log(`🔍 Attempting to cancel waiting job with ID: ${jobId}`);
    
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
    
    console.log(`🗑️ Total cancelled waiting message job(s): ${numRemoved} with ID: ${jobId}`);
    return numRemoved > 0;
  } catch (error) {
    console.error('❌ Error cancelling waiting message job:', error);
    return false;
  }
};

export const cancelAndRescheduleWaitingMessage = async (
  conversationId: number,
  recipient: string,
  agentPhoneNumberId: string | undefined
): Promise<void> => {
  try {
    console.log(`🔄 cancelAndRescheduleWaitingMessage called for conversation ${conversationId}`);
    
    // Get current conversation to check for existing job
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { waitingJobId: true, waitingMessageSent: true }
    });

    console.log(`📋 Current conversation state:`);
    console.log(`   - waitingJobId: ${conversation?.waitingJobId || 'None'}`);
    console.log(`   - waitingMessageSent: ${conversation?.waitingMessageSent || false}`);

    // Cancel existing job if it exists
    if (conversation?.waitingJobId) {
      console.log(`🗑️ Cancelling existing waiting job: ${conversation.waitingJobId}`);
      await cancelWaitingMessageJob(conversation.waitingJobId);
    }

    // Always schedule a new job (whether there was an existing one or not)
    console.log(`⏰ Scheduling new waiting message job...`);
    const newJobId = await scheduleWaitingMessageJob(conversationId, recipient, agentPhoneNumberId);
    console.log(`📝 New job ID received: ${newJobId}`);

    if (newJobId) {
      console.log(`💾 Updating conversation ${conversationId} with new job ID: ${newJobId}`);
      // Update conversation with new job ID and reset waiting message flag
      await prisma.conversation.update({
        where: { id: conversationId },
        data: {
          waitingJobId: newJobId,
          waitingMessageSent: false // Always reset this flag when scheduling new job
        }
      });
      console.log(`✅ Conversation updated successfully with new job`);
    } else {
      console.log(`❌ Failed to get new job ID - conversation not updated`);
      
      // Even if job scheduling failed, reset the flag so we can try again
      await prisma.conversation.update({
        where: { id: conversationId },
        data: {
          waitingJobId: null,
          waitingMessageSent: false
        }
      });
      console.log(`🔄 Reset waiting message flags after scheduling failure`);
    }
  } catch (error) {
    console.error('❌ Error in cancelAndRescheduleWaitingMessage:', error);
    console.error('Error stack:', (error as Error).stack);
  }
};

export const cancelWaitingMessageForConversation = async (conversationId: number): Promise<void> => {
  try {
    console.log(`🗑️ cancelWaitingMessageForConversation called for conversation ${conversationId}`);
    
    // Get current conversation to check for existing job
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { waitingJobId: true }
    });

    console.log(`📋 Current waitingJobId: ${conversation?.waitingJobId || 'None'}`);

    // Cancel existing job if it exists
    if (conversation?.waitingJobId) {
      console.log(`🗑️ Cancelling waiting job: ${conversation.waitingJobId}`);
      await cancelWaitingMessageJob(conversation.waitingJobId);

      // Clear the job ID from conversation
      await prisma.conversation.update({
        where: { id: conversationId },
        data: {
          waitingJobId: null,
          waitingMessageSent: false
        }
      });
      console.log(`✅ Waiting message job cancelled and cleared from conversation ${conversationId}`);
    } else {
      console.log(`✅ No waiting job to cancel for conversation ${conversationId}`);
    }
  } catch (error) {
    console.error('❌ Error cancelling waiting message for conversation:', error);
    console.error('Error stack:', (error as Error).stack);
  }
}; 