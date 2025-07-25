import agenda from '../config/agenda';
import { prisma } from '../models/prismaClient';

// Log environment variable on module load
console.log(`🔧 NO_RESPONSE_24H_DURATION_MINUTES environment variable: ${process.env.NO_RESPONSE_24H_DURATION_MINUTES || 'NOT SET (using default: 1440 minutes = 24 hours)'}`);

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
    const durationMinutes = parseInt(process.env.NO_RESPONSE_24H_DURATION_MINUTES || '1440'); // Default 1440 minutes = 24 hours
    const scheduleTime = new Date(Date.now() + durationMinutes * 60 * 1000);
    
    console.log(`📅 schedule24hNoResponseJob called:`);
    console.log(`   - conversationId: ${conversationId}`);
    console.log(`   - recipient: ${recipient}`);
    console.log(`   - agentPhoneNumberId: ${agentPhoneNumberId}`);
    console.log(`   - durationMinutes: ${durationMinutes}`);
    console.log(`   - scheduleTime: ${scheduleTime.toISOString()}`);
    
    const jobData: NoResponse24hJobData = {
      conversationId,
      recipient,
      agentPhoneNumberId
    };

    console.log(`🚀 Calling agenda.schedule with jobData:`, jobData);
    const job = await agenda.schedule(scheduleTime, 'no-response-24h-job', jobData);
    console.log(`✅ 24h job scheduled successfully. Job ID: ${job.attrs._id?.toString()}`);
    console.log(`📋 Job details:`, {
      id: job.attrs._id?.toString(),
      name: job.attrs.name,
      data: job.attrs.data,
      nextRunAt: job.attrs.nextRunAt
    });
    
    return job.attrs._id?.toString() || null;
  } catch (error) {
    console.error('❌ Error scheduling 24h no response job:', error);
    console.error('Error stack:', (error as Error).stack);
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
    console.log(`🔄 reschedule24hJobForConversation called for conversation ${conversationId}`);
    
    // Get current conversation to check for existing job
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { noResponse24hJobId: true, noResponse24hSent: true }
    });

    console.log(`📋 Current conversation 24h state:`);
    console.log(`   - noResponse24hJobId: ${conversation?.noResponse24hJobId || 'None'}`);
    console.log(`   - noResponse24hSent: ${conversation?.noResponse24hSent || false}`);

    // Cancel existing job if it exists
    if (conversation?.noResponse24hJobId) {
      console.log(`🗑️ Cancelling existing 24h job: ${conversation.noResponse24hJobId}`);
      await cancel24hNoResponseJob(conversation.noResponse24hJobId);
    }

    // Always schedule a new job (agent just sent a message)
    console.log(`⏰ Scheduling new 24h job after agent message...`);
    const newJobId = await schedule24hNoResponseJob(conversationId, recipient, agentPhoneNumberId);
    console.log(`📝 New 24h job ID received: ${newJobId}`);

    if (newJobId) {
      console.log(`💾 Updating conversation ${conversationId} with new 24h job ID: ${newJobId}`);
      // Update conversation with new job ID and reset flags
      await prisma.conversation.update({
        where: { id: conversationId },
        data: {
          noResponse24hJobId: newJobId,
          noResponse24hSent: false, // Reset since agent sent new message
          lastCustomerMessageAt: null // Reset customer message tracking
        }
      });
      console.log(`✅ Conversation updated successfully with new 24h job`);
    } else {
      console.log(`❌ Failed to get new 24h job ID - conversation not updated`);
    }
  } catch (error) {
    console.error('❌ Error in reschedule24hJobForConversation:', error);
    console.error('Error stack:', (error as Error).stack);
  }
};

export const updateCustomerMessageTimestamp = async (conversationId: number): Promise<void> => {
  try {
    console.log(`📨 Updating customer message timestamp for conversation ${conversationId}`);
    
    await prisma.conversation.update({
      where: { id: conversationId },
      data: {
        lastCustomerMessageAt: new Date()
      }
    });
    
    console.log(`✅ Customer message timestamp updated for conversation ${conversationId}`);
  } catch (error) {
    console.error('❌ Error updating customer message timestamp:', error);
  }
};

export const cancel24hJobForConversation = async (conversationId: number): Promise<void> => {
  try {
    console.log(`🗑️ cancel24hJobForConversation called for conversation ${conversationId}`);
    
    // Get current conversation to check for existing job
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { noResponse24hJobId: true }
    });

    console.log(`📋 Current 24h job ID: ${conversation?.noResponse24hJobId || 'None'}`);

    // Cancel existing job if it exists
    if (conversation?.noResponse24hJobId) {
      console.log(`🗑️ Cancelling 24h job: ${conversation.noResponse24hJobId}`);
      await cancel24hNoResponseJob(conversation.noResponse24hJobId);

      // Clear the job ID from conversation
      await prisma.conversation.update({
        where: { id: conversationId },
        data: {
          noResponse24hJobId: null,
          noResponse24hSent: false
        }
      });
      console.log(`✅ 24h job cancelled and cleared from conversation ${conversationId}`);
    } else {
      console.log(`✅ No 24h job to cancel for conversation ${conversationId}`);
    }
  } catch (error) {
    console.error('❌ Error cancelling 24h job for conversation:', error);
    console.error('Error stack:', (error as Error).stack);
  }
}; 