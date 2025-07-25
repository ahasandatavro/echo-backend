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
    const numRemoved = await agenda.cancel({ _id: jobId as any });
    console.log(`Cancelled ${numRemoved} waiting message job(s) with ID: ${jobId}`);
    return numRemoved > 0;
  } catch (error) {
    console.error('Error cancelling waiting message job:', error);
    return false;
  }
};

export const scheduleWaitingMessageIfNeeded = async (
  conversationId: number,
  recipient: string,
  agentPhoneNumberId: string | undefined
): Promise<void> => {
  try {
    console.log(`🔄 scheduleWaitingMessageIfNeeded called for conversation ${conversationId}`);
    
    // Get current conversation to check for existing job
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { waitingJobId: true, waitingMessageSent: true }
    });

    console.log(`📋 Current conversation state:`);
    console.log(`   - waitingJobId: ${conversation?.waitingJobId || 'None'}`);
    console.log(`   - waitingMessageSent: ${conversation?.waitingMessageSent || false}`);

    // Only schedule if no job is currently scheduled
    if (!conversation?.waitingJobId) {
      console.log(`⏰ No existing job found, scheduling new waiting message job...`);
      const newJobId = await scheduleWaitingMessageJob(conversationId, recipient, agentPhoneNumberId);
      console.log(`📝 New job ID received: ${newJobId}`);

      if (newJobId) {
        console.log(`💾 Updating conversation ${conversationId} with new job ID: ${newJobId}`);
        // Update conversation with new job ID and reset waiting message flag
        await prisma.conversation.update({
          where: { id: conversationId },
          data: {
            waitingJobId: newJobId,
            waitingMessageSent: false
          }
        });
        console.log(`✅ Conversation updated successfully`);
      } else {
        console.log(`❌ Failed to get new job ID - conversation not updated`);
      }
    } else {
      console.log(`⏰ Job already exists (${conversation.waitingJobId}), skipping scheduling`);
    }
  } catch (error) {
    console.error('❌ Error in scheduleWaitingMessageIfNeeded:', error);
    console.error('Error stack:', (error as Error).stack);
  }
};

export const resetWaitingMessageState = async (conversationId: number): Promise<void> => {
  try {
    // Get current conversation to check for existing job
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { waitingJobId: true }
    });

    // Cancel existing job if it exists
    if (conversation?.waitingJobId) {
      await cancelWaitingMessageJob(conversation.waitingJobId);
    }

    // Reset waiting message state
    await prisma.conversation.update({
      where: { id: conversationId },
      data: {
        waitingJobId: null,
        waitingMessageSent: false,
        lastAgentMessageAt: new Date()
      }
    });

    console.log(`Reset waiting message state for conversation ${conversationId}`);
  } catch (error) {
    console.error('Error resetting waiting message state:', error);
  }
}; 