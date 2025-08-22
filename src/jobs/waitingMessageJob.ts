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

    console.log(`🔄 Processing waiting message job:`);
    console.log(`   - Job ID: ${job.attrs._id}`);
    console.log(`   - Conversation ID: ${conversationId}`);
    console.log(`   - Recipient: ${recipient}`);

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
          take: 10
        }
      }
    });

    if (!conversation) {
      console.log(`❌ Conversation not found: ${conversationId}`);
      return;
    }

    if (conversation.waitingMessageSent) {
      console.log(`⏭️ Waiting message already sent for conversation: ${conversationId}`);
      return;
    }

    // Log environment variable usage in job execution
    const rawDuration = process.env.WAITING_MESSAGE_DURATION_MINUTES;
    const durationMinutes = parseInt(rawDuration || '10');
    const jobScheduledTime = new Date(Date.now() - (durationMinutes * 60 * 1000));
    
    console.log(`⏰ WAITING_MESSAGE_DURATION_MINUTES in job execution:`);
    console.log(`   - Raw env value: "${rawDuration}"`);
    console.log(`   - Parsed minutes: ${durationMinutes}`);
    console.log(`   - Current time: ${new Date().toISOString()}`);
    console.log(`   - Job scheduled time (${durationMinutes} min ago): ${jobScheduledTime.toISOString()}`);
    console.log(`   - Duration in ms: ${durationMinutes * 60 * 1000}`);
    console.log(`   - Fallback used: ${!rawDuration ? 'YES (default: 10 minutes)' : 'NO'}`);
    
    const hasAgentRepliedSinceScheduled = conversation.lastAgentMessageAt && 
      conversation.lastAgentMessageAt > jobScheduledTime;

    console.log(`🔍 Agent reply check:`);
    console.log(`   - Last agent message at: ${conversation.lastAgentMessageAt?.toISOString() || 'None'}`);
    console.log(`   - Job scheduled time: ${jobScheduledTime.toISOString()}`);
    console.log(`   - Has agent replied since scheduled: ${hasAgentRepliedSinceScheduled}`);

    if (hasAgentRepliedSinceScheduled) {
      console.log(`⏭️ Agent replied after job was scheduled, skipping waiting message`);
      return;
    }

    const recentAgentMessages = conversation.messages.filter(msg => 
      msg.sender === 'user' && 
      msg.createdAt > jobScheduledTime
    );

    console.log(`📝 Recent agent messages check:`);
    console.log(`   - Total messages in conversation: ${conversation.messages.length}`);
    console.log(`   - Messages after scheduled time: ${recentAgentMessages.length}`);
    console.log(`   - Recent agent messages:`, recentAgentMessages.map(msg => ({
      id: msg.id,
      sender: msg.sender,
      createdAt: msg.createdAt.toISOString(),
      text: msg.text?.substring(0, 50) + '...'
    })));

    if (recentAgentMessages.length > 0) {
      console.log(`⏭️ Found recent agent messages, skipping waiting message`);
      return;
    }

    const defaultActionSettings = conversation.businessPhoneNumber?.defaultActionSettings;

    console.log(`⚙️ Default action settings check:`);
    console.log(`   - Waiting message enabled: ${defaultActionSettings?.waitingMessageEnabled}`);
    console.log(`   - Material type: ${defaultActionSettings?.waitingMessageMaterialType}`);
    console.log(`   - Material ID: ${defaultActionSettings?.waitingMessageMaterialId}`);

    if (!defaultActionSettings?.waitingMessageEnabled || 
        !defaultActionSettings.waitingMessageMaterialType || 
        !defaultActionSettings.waitingMessageMaterialId) {
      console.log(`❌ Waiting message not properly configured, skipping`);
      return;
    }

    console.log(`📤 Sending waiting message...`);
    const sent = await sendDefaultMaterial(
      defaultActionSettings.waitingMessageMaterialType,
      defaultActionSettings.waitingMessageMaterialId,
      recipient,
      1,
      agentPhoneNumberId
    );

    if (sent) {
      console.log(`✅ Waiting message sent successfully`);
      await prisma.conversation.update({
        where: { id: conversationId },
        data: {
          waitingMessageSent: true,
          waitingJobId: null
        }
      });
    } else {
      console.log(`❌ Failed to send waiting message`);
    }

    await prisma.conversation.update({
      where: { id: conversationId },
      data: {
        waitingJobId: null
      }
    });

    console.log(`🏁 Waiting message job completed for conversation: ${conversationId}`);

  } catch (error) {
    console.error('Error processing waiting message job:', error);
  }
}; 