import { prisma } from "../../models/prismaClient";
import { processChatFlow, sendMessage, sendTemplate } from "./webhookProcessor";
import { Chatbot, Contact, Keyword, KeywordReplyMaterial, KeywordRoutingMaterial, KeywordTemplate, MaterialType, ReplyMaterial, RoutingMaterial, RoutingType, Team, Template, User } from "@prisma/client";

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

/**
 * Process a keyword and trigger associated actions
 * (chatbots, templates, reply materials, routing materials)
 * 
 * @param text The text to match against keywords
 * @param recipient The recipient's phone number
 * @returns A boolean indicating whether any action was taken
 */
export const processKeyword = async (text: string, recipient: string): Promise<boolean> => {
  if (!text) return false;

  try {
    // Find keyword with all possible related entities
    const keyword = await prisma.keyword.findFirst({
      where: {
        value: {
          contains: text,
          mode: "insensitive",
        },
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

    if (!keyword) return false;

    let actionsPerformed = false;

    // 1. Process chatbot if associated
    if (keyword.chatbot) {
      console.log(`Triggering chatbot with ID: ${keyword.chatbot.id} for keyword "${keyword.value}"`);
      
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
      await processChatFlow(keyword.chatbot.id, recipient);
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
            keywordTemplate.template
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
          
          await sendMessage(recipient, messageContent, chatbotId);
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