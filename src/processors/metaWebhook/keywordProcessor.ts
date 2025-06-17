import { String } from "aws-sdk/clients/cloudsearch";
import { prisma } from "../../models/prismaClient";
import { processChatFlow, sendMessage, sendTemplate } from "./webhookProcessor";
import { Chatbot, Contact, Keyword, KeywordReplyMaterial, KeywordRoutingMaterial, KeywordTemplate, MaterialType, ReplyMaterial, RoutingMaterial, RoutingType, Team, Template, User } from "@prisma/client";
import dayjs from 'dayjs';
import { DefaultActionSettings } from '@prisma/client'; 
import { bump } from "../../helpers";
// Define types for the keyword query result
type KeywordWithRelations = Keyword & {
  chatbot: Chatbot | null;
  keywordTemplates: (KeywordTemplate & {
    template: Template;
  })[];
  replyMaterials: (KeywordReplyMaterial & {
    replyMaterial: ReplyMaterial;
  })[];
  routingMaterials: (KeywordRoutingMaterial & {
    routingMaterial: RoutingMaterial & {
      assignedUser: User | null;
      team: Team | null;
    };
  })[];
};

type TimeSlot = {
  from: string;
  to: string;
};

type DaySchedule = {
  open: boolean;
  times: TimeSlot[];
};

type WorkingHours = {
  [day: string]: DaySchedule;
};

export const processKeyword = async (text: string, recipient: String, agentPhoneNumberId: string | undefined): Promise<boolean> => {
  if (!text) return false;
  const businessPhoneNumber = await prisma.businessPhoneNumber.findFirst({
    where: { metaPhoneNumberId: agentPhoneNumberId },
    select: {
      id: true,
      fallbackEnabled: true,
      fallbackMessage: true,
      fallbackTriggerCount: true,
      defaultActionSettings: true,  // your existing logic
      fallbackHitCount: true,
      metaPhoneNumberId: true,
    }
  });
 const dbUser=await prisma.user.findFirst({where:{selectedPhoneNumberId:businessPhoneNumber?.metaPhoneNumberId}})
  const defaultActionSettings = await prisma.defaultActionSettings.findUnique({
    where: {
      businessPhoneNumberId: businessPhoneNumber?.id,
    },
  });
  // Use the new helper function
  const defaultHandled = await checkAndSendDefaultMaterial(defaultActionSettings, recipient, agentPhoneNumberId,text);
  if (defaultHandled) return true;
  try {
    // Find keyword with all possible related entities
    const keyword = await prisma.keyword.findFirst({
      where: {
        value: {
          equals: text,
          mode: "insensitive",
        },
        userId: dbUser?.id
      },
      include: { 
        chatbot: true,
        keywordTemplates: {
          include: {
            template: true
          }
        },
        replyMaterials: {
          include: {
            replyMaterial: true
          }
        },
        routingMaterials: {
          include: {
            routingMaterial: {
              include: {
                assignedUser: true,
                team: true
              }
            }
          }
        }
      }
    }) as KeywordWithRelations | null;

    if (!keyword) {
      return false;

    }
    
    let actionsPerformed = false;

    // 1. Process chatbot if associated
    if (keyword?.chatbot) {
      console.log(`Triggering chatbot with ID: ${keyword.chatbot.id} for keyword "${keyword.value}"`);
      await bump(keyword.chatbot.id, "triggered");
      // Update conversation to not be answering a question anymore
      const conversation = await prisma.conversation.findFirst({ 
        where: { recipient },
        orderBy: { updatedAt: "desc" } 
      });
      
      if (conversation) {
        await prisma.conversation.update({
          where: { id: conversation.id },
          data: { answeringQuestion: false }
        });
      }

      // Process the chatbot flow
      await processChatFlow(keyword.chatbot.id, recipient, agentPhoneNumberId);
      actionsPerformed = true;
    }

    // 2. Process templates if associated
    if (keyword.keywordTemplates && keyword.keywordTemplates.length > 0) {
      for (const keywordTemplate of keyword.keywordTemplates) {
        if (keywordTemplate.template) {
          console.log(`Sending template "${keywordTemplate.template.name}" for keyword "${keyword.value}"`);
          
          // Use default chatbotId 1 if no chatbot is associated with the keyword
          const chatbotId = keyword.chatbot?.id || 1;
          
          await sendTemplate(
            recipient, 
            keywordTemplate.template.name, 
            chatbotId,
            keywordTemplate.template,
            agentPhoneNumberId
          );
          actionsPerformed = true;
        }
      }
    }

    // 3. Process reply materials if associated
    if (keyword.replyMaterials && keyword.replyMaterials.length > 0) {
      for (const keywordReplyMaterial of keyword.replyMaterials) {
        const replyMaterial = keywordReplyMaterial.replyMaterial;
        if (replyMaterial) {
          console.log(`Sending reply material "${replyMaterial.name}" for keyword "${keyword.value}"`);
          
          // Determine the message type and content based on material type
          let messageContent: any;
          
          // Convert MaterialType to a format that sendMessage understands
          if (replyMaterial.type === "TEXT") {
            // Handle text type - simplest format
            messageContent = {
              type: "text", 
              message: replyMaterial.content || replyMaterial.name
            };
          } else {
            // Handle media types (IMAGE, VIDEO, DOCUMENT, etc.)
            messageContent = {
              type: replyMaterial.type.toLowerCase(),
              message: {
                name: replyMaterial.name,
                url: replyMaterial.fileUrl
              }
            };
          }

          // Use default chatbotId 1 if no chatbot is associated with the keyword
          const chatbotId = keyword.chatbot?.id || 1;
          
          await sendMessage(recipient, messageContent, chatbotId, dbUser?.id, true, agentPhoneNumberId);
          actionsPerformed = true;
        }
      }
    }

    // 4. Process routing materials if associated
    if (keyword.routingMaterials && keyword.routingMaterials.length > 0) {
      for (const keywordRoutingMaterial of keyword.routingMaterials) {
        const routingMaterial = keywordRoutingMaterial.routingMaterial;
        
        if (routingMaterial) {
          console.log(`Processing routing material "${routingMaterial.materialName}" for keyword "${keyword.value}"`);
          
          // Perform actions based on routing type
          switch (routingMaterial.type) {
            case "AssignUser":
              if (routingMaterial.assignedUser && routingMaterial.assignedUserId) {
                await prisma.contact.upsert({
                  where: { phoneNumber: recipient },
                  update: { userId: routingMaterial.assignedUserId },
                  create: {
                    phoneNumber: recipient,
                    name: "Unknown",
                    source: "WhatsApp",
                    userId: routingMaterial.assignedUserId,
                  }
                });
                console.log(`Assigned user ID ${routingMaterial.assignedUserId} to contact ${recipient}`);
                const contactRecord = await prisma.contact.findUnique({
                  where: { phoneNumber: recipient },
                  select: { id: true }
                });
                if (!contactRecord) {
                  throw new Error(`Contact with phoneNumber ${recipient} not found.`);
                }
                await prisma.chatStatusHistory.create({
                  data: {
                    contactId: contactRecord?.id||0,
                    newStatus: "Assigned",
                    type: "assignmentChanged",
                    note: `Assigned to agent ${routingMaterial.assignedUser.email}`, 
                    assignedToUserId: routingMaterial.assignedUserId,
                    changedById:  null,
                    changedAt: new Date(),
                  }
                });
              }
              break;
              
            case "AssignTeam":
              if (routingMaterial.team && routingMaterial.teamId) {
                const contact = await prisma.contact.findUnique({
                  where: { phoneNumber: recipient },
                  include: { assignedTeams: true }
                }) as (Contact & { assignedTeams: Team[] }) | null;
                
                if (contact) {
                  // Add the team to contact's teams if not already assigned
                  const isTeamAssigned = contact.assignedTeams.some(t => t.id === routingMaterial.teamId);
                  
                  if (!isTeamAssigned && routingMaterial.teamId) {
                    await prisma.contact.update({
                      where: { id: contact.id },
                      data: {
                        assignedTeams: {
                          connect: { id: routingMaterial.teamId }
                        }
                      }
                    });
                    console.log(`Assigned team ID ${routingMaterial.teamId} to contact ${recipient}`);
                    const contactRecord = await prisma.contact.findUnique({
                      where: { phoneNumber: recipient },
                      select: { id: true }
                    });
                    if (!contactRecord) { 
                      throw new Error(`Contact with phoneNumber ${recipient} not found.`);
                    }
                    await prisma.chatStatusHistory.create({
                      data: {
                        contactId: contactRecord?.id||0,
                        newStatus: "Assigned",
                        type: "assignmentChanged",
                        note: `Assigned to Team: ${routingMaterial.team.name}`,
                        changedById: null,
                        changedAt: new Date(),
                      }
                    });
                  }
                } else {
                  // Create contact with team assignment
                  if (routingMaterial.teamId) {
                    await prisma.contact.create({
                      data: {
                        phoneNumber: recipient,
                        name: "Unknown",
                        source: "WhatsApp",
                        assignedTeams: {
                          connect: { id: routingMaterial.teamId }
                        }
                      }
                    });
                    console.log(`Created contact ${recipient} with team ID ${routingMaterial.teamId}`);
                  }
                }
              }
              break;
              
            case "Notification":
              // For Notification type, we don't need immediate action in the webhook,
              // as this would typically generate notifications elsewhere in the system
              console.log(`Notification routing triggered for ${recipient} with material ID ${routingMaterial.id}`);
              break;
          }
          
          actionsPerformed = true;
        }
      }
    }

    return actionsPerformed;
  } catch (error) {
    console.error(`Error processing keyword "${text}":`, error);
    return false;
  }
}; 

const checkAndSendDefaultMaterial = async (
  defaultActionSettings: any,
  recipient: string,
  agentPhoneNumberId: string | undefined,
  text: string
): Promise<boolean> => {
  // Check for outside working hours
  if (
    defaultActionSettings?.outsideWorkingHoursEnabled &&
    defaultActionSettings.workingHours
  ) {
    const workingHours = defaultActionSettings.workingHours as WorkingHours;

    if (!isWithinWorkingHours(workingHours)) {
      const type = defaultActionSettings.outsideWorkingHoursMaterialType;
      const id = defaultActionSettings.outsideWorkingHoursMaterialId;

      if (type && id) {
        const sent = await sendDefaultMaterial(type, id, recipient,1,agentPhoneNumberId);
        if (sent) return true;
      }
    }
  }

  // Check for no agents online
  if (defaultActionSettings?.noAgentOnlineEnabled && agentPhoneNumberId) {
    // Find all agents with matching selectedPhoneNumberId
    const agents = await prisma.user.findMany({
      where: {
        selectedPhoneNumberId: agentPhoneNumberId,
      },
      select: {
        isOnline: true
      }
    });

    // Check if any agent is online
    const hasOnlineAgent = agents.some(agent => agent.isOnline);

    if (!hasOnlineAgent) {
      const type = defaultActionSettings.noAgentOnlineMaterialType;
      const id = defaultActionSettings.noAgentOnlineMaterialId;

      if (type && id) {
        const sent = await sendDefaultMaterial(type, id, recipient, 1, agentPhoneNumberId);
        if (sent) return true;
      }
    }
  }

  // Check for welcome message
  if (defaultActionSettings?.welcomeMessageEnabled && agentPhoneNumberId) {
    // Only send if this is the first message (no conversation exists for this recipient and agentPhoneNumberId)
    const existingConversation = await prisma.conversation.findFirst({
      where: {
        recipient,
        businessPhoneNumberId: defaultActionSettings.businessPhoneNumberId,
      },
    });
//find the messages length for this conversation. If lesst than two then send the welcome message else do nothing
    const messages = await prisma.message.findMany({
      where: {
        conversationId: existingConversation?.id,
      },
    });
    if (messages.length < 10) {  
    // Check for keyword match (same logic as processKeyword)
    let dbUser = await prisma.user.findFirst({ where: { selectedPhoneNumberId: agentPhoneNumberId } });
    const keyword = await prisma.keyword.findFirst({
      where: {
        value: {
          equals: text,
          mode: "insensitive",
        },
        userId: dbUser?.id
      }
    });

    if ( !keyword) {
      const type = defaultActionSettings.welcomeMessageMaterialType;
      const id = defaultActionSettings.welcomeMessageMaterialId;

      if (type && id) {
        const sent = await sendDefaultMaterial(type, id, recipient, 1, agentPhoneNumberId);
        if (sent) return true;
      }
    }
  }else{
    return false;
  }
  }

  return false;
};


export const sendDefaultMaterial = async (
  type: keyof typeof MaterialType | string,
  id: number,
  recipient: string,
  fallbackChatbotId: number = 1,
  agentPhoneNumberId: string | undefined
): Promise<boolean> => {
  try {
    switch (type) {
      case 'TEXT':
      case 'IMAGE':
      case 'VIDEO':
      case 'DOCUMENT':
      case 'STICKER':
      case 'CONTACT_ATTRIBUTES': {
        const replyMaterial = await prisma.replyMaterial.findUnique({ where: { id } });
        if (replyMaterial) {
          const messageContent = replyMaterial.type === 'TEXT'
            ? { type: 'text', message: replyMaterial.content || replyMaterial.name }
            : {
                type: replyMaterial.type.toLowerCase(),
                message: {
                  name: replyMaterial.name,
                  url: replyMaterial.fileUrl,
                },
              };

          await sendMessage(recipient, messageContent, fallbackChatbotId,1,true,agentPhoneNumberId);
          return true;
        }
        break;
      }

      case 'template': {
        const template = await prisma.template.findUnique({ where: { id } });
        if (template) {
          await sendTemplate(recipient, template.name, fallbackChatbotId, template,agentPhoneNumberId);
          return true;
        }
        break;
      }
      case 'templates': {
        const template = await prisma.template.findUnique({ where: { id } });
        if (template) {
          await sendTemplate(recipient, template.name, fallbackChatbotId, template,agentPhoneNumberId);
          return true;
        }
        break;
      }
      case 'chatbot': {
        await processChatFlow(id, recipient, agentPhoneNumberId);
        return true;
      }

      default:
        console.warn(`Unsupported default material type: ${type}`);
    }
  } catch (error) {
    console.error(`Failed to send default material (type: ${type}, id: ${id})`, error);
  }

  return false;
};

export const isWithinWorkingHours = (workingHours: WorkingHours): boolean => {
  const now = dayjs();
  const currentDay = now.format('dddd'); // e.g., "Thursday"
  const todaySchedule = workingHours[currentDay];

  if (!todaySchedule?.open || !Array.isArray(todaySchedule.times)) return false;

  for (const timeSlot of todaySchedule.times) {
    const from = dayjs(`${now.format('YYYY-MM-DD')} ${timeSlot.from}`);
    let to = dayjs(`${now.format('YYYY-MM-DD')} ${timeSlot.to}`);

    // Handle overnight shift: e.g., from 23:00 to 06:00
    if (to.isBefore(from)) {
      to = to.add(1, 'day');
    }

    if (now.isAfter(from) && now.isBefore(to)) {
      return true;
    }
  }

  return false;
};

export const handleFallbackMaterial = async (
  defaultActionSettings: DefaultActionSettings | null,
  recipient: string,
  agentPhoneNumberId: string | undefined
): Promise<boolean> => {
  try {
    if (
      defaultActionSettings?.fallbackMessageEnabled &&
      defaultActionSettings.fallbackMessageMaterialType &&
      defaultActionSettings.fallbackMessageMaterialId
    ) {
      console.log(`No keyword matched. Sending fallback material of type "${defaultActionSettings.fallbackMessageMaterialType}"`);

      const sent = await sendDefaultMaterial(
        defaultActionSettings.fallbackMessageMaterialType,
        defaultActionSettings.fallbackMessageMaterialId,    
        recipient,
        1,
        agentPhoneNumberId
      );

      return sent;
    }

    console.log(`No keyword matched and fallback is disabled or incomplete.`);
    return false;
  } catch (error) {
    console.error('Error handling fallback material:', error);
    return false;
  }
};
