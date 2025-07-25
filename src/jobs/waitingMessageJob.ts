import { Job } from '@hokify/agenda';
import { prisma } from '../models/prismaClient';
import { sendDefaultMaterial } from '../processors/metaWebhook/keywordProcessor';

interface WaitingMessageJobData {
  conversationId: number;
  recipient: string;
  agentPhoneNumberId: string | undefined;
}

export const processWaitingMessageJob = async (job: Job<WaitingMessageJobData>) => {
  try {
    const { conversationId, recipient, agentPhoneNumberId } = job.attrs.data;

    console.log(`🚀 Processing waiting message job for conversation ${conversationId}`);
    console.log(`📋 Job data:`, job.attrs.data);
    console.log(`⏰ Job scheduled at: ${job.attrs.nextRunAt}`);
    console.log(`🔍 Current time: ${new Date().toISOString()}`);

    // Get the conversation with its business phone number and default action settings
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        businessPhoneNumber: {
          include: {
            defaultActionSettings: true
          }
        },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 10 // Get last 10 messages to check for agent replies
        }
      }
    });

    if (!conversation) {
      console.log(`Conversation ${conversationId} not found, skipping waiting message`);
      return;
    }

    // Check if waiting message was already sent for this waiting period
    if (conversation.waitingMessageSent) {
      console.log(`✋ Waiting message already sent for conversation ${conversationId}`);
      return;
    }

    // Check if an agent has replied since the job was scheduled
    const jobScheduledTime = new Date(Date.now() - (parseInt(process.env.WAITING_MESSAGE_DURATION_MINUTES || '10') * 60 * 1000));
    const hasAgentRepliedSinceScheduled = conversation.lastAgentMessageAt && 
      conversation.lastAgentMessageAt > jobScheduledTime;

    console.log(`📅 Job was scheduled around: ${jobScheduledTime.toISOString()}`);
    console.log(`💬 Last agent message at: ${conversation.lastAgentMessageAt?.toISOString() || 'Never'}`);
    console.log(`🔍 Agent replied since job scheduled: ${hasAgentRepliedSinceScheduled}`);

    if (hasAgentRepliedSinceScheduled) {
      console.log(`✋ Agent replied to conversation ${conversationId} since job was scheduled, skipping waiting message`);
      return;
    }

    // Additional check: Look for recent agent messages in the conversation
    const recentAgentMessages = conversation.messages.filter(msg => 
      msg.sender === 'user' && // Assuming 'user' means agent in this context - you may need to adjust this
      msg.createdAt > jobScheduledTime
    );

    console.log(`📨 Found ${recentAgentMessages.length} recent agent messages since job was scheduled`);

    if (recentAgentMessages.length > 0) {
      console.log(`✋ Found recent agent messages in conversation ${conversationId}, skipping waiting message`);
      return;
    }

    const defaultActionSettings = conversation.businessPhoneNumber?.defaultActionSettings;

    // Check if waiting message is enabled and configured
    if (!defaultActionSettings?.waitingMessageEnabled || 
        !defaultActionSettings.waitingMessageMaterialType || 
        !defaultActionSettings.waitingMessageMaterialId) {
      console.log(`Waiting message not enabled or not configured for conversation ${conversationId}`);
      return;
    }

    // Send the waiting message
    console.log(`Sending waiting message for conversation ${conversationId}`);
    const sent = await sendDefaultMaterial(
      defaultActionSettings.waitingMessageMaterialType,
      defaultActionSettings.waitingMessageMaterialId,
      recipient,
      1,
      agentPhoneNumberId
    );

    if (sent) {
      // Mark waiting message as sent and clear job ID
      await prisma.conversation.update({
        where: { id: conversationId },
        data: {
          waitingMessageSent: true,
          waitingJobId: null
        }
      });
      console.log(`✅ Waiting message sent successfully for conversation ${conversationId}`);
    } else {
      console.error(`❌ Failed to send waiting message for conversation ${conversationId}`);
    }

    // Always clear the job ID after processing (whether sent or not)
    await prisma.conversation.update({
      where: { id: conversationId },
      data: {
        waitingJobId: null
      }
    });
    console.log(`🧹 Cleared job ID for conversation ${conversationId}`);

  } catch (error) {
    console.error('Error processing waiting message job:', error);
  }
}; 