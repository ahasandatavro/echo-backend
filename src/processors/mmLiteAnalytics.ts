import {prisma} from "../models/prismaClient";

// MM Lite API Analytics Processing Functions
export const processTemplateAnalytics = async (analyticsData: any) => {
  try {
    console.log("Processing MM Lite template analytics:", JSON.stringify(analyticsData, null, 2));

    const {template_id, phone_number_id, analytics} = analyticsData;

    if (!template_id || !analytics) {
      console.warn("Invalid template analytics data received");
      return;
    }

    // Find broadcasts using this template
    const broadcasts = await prisma.broadcast.findMany({
      where: {
        templateId: template_id,
        phoneNumberId: phone_number_id,
        apiType: "MM_LITE"
      }
    });

    for (const broadcast of broadcasts) {
      // Update broadcast metrics based on analytics data
      const updateData: any = {};

      if (analytics.sent !== undefined) updateData.totalSent = analytics.sent;
      if (analytics.delivered !== undefined) updateData.totalDelivered = analytics.delivered;
      if (analytics.read !== undefined) updateData.totalRead = analytics.read;
      if (analytics.clicked !== undefined) updateData.totalClicked = analytics.clicked;
      if (analytics.replied !== undefined) updateData.totalReplied = analytics.replied;

      // Handle button clicks
      if (analytics.button_clicks) {
        updateData.buttonClicks = analytics.button_clicks;
        // Sum all button clicks for total website clicks
        const totalButtonClicks = Object.values(analytics.button_clicks as Record<string, number>)
          .reduce((sum: number, clicks: number) => sum + clicks, 0);
        updateData.websiteClicks = totalButtonClicks;
      }

      await prisma.broadcast.update({
        where: {id: broadcast.id},
        data: updateData
      });

      // Create detailed metrics records
      for (const [metricType, value] of Object.entries(analytics)) {
        if (typeof value === 'number' && value > 0) {
          await prisma.broadcastMetric.create({
            data: {
              broadcastId: broadcast.id,
              metricType,
              metricValue: value,
              timestamp: new Date()
            }
          });
        }
      }
    }

    console.log(`Updated analytics for ${broadcasts.length} broadcasts`);
  } catch (error) {
    console.error("Error processing template analytics:", error);
  }
};

export const processMessageEchoes = async (echoData: any) => {
  try {
    console.log("Processing MM Lite message echoes:", JSON.stringify(echoData, null, 2));

    const {messages} = echoData;

    if (!messages || !Array.isArray(messages)) {
      return;
    }

    for (const message of messages) {
      const {id: messageId, to: recipient, template} = message;

      if (!template || !template.name) {
        continue;
      }

      // Find broadcast by template name and recipient
      const contact = await prisma.contact.findFirst({
        where: {phoneNumber: recipient}
      });

      if (!contact) continue;

      const broadcastRecipient = await prisma.broadcastRecipient.findFirst({
        where: {
          contactId: contact.id,
          broadcast: {
            templateName: template.name,
            status: "SENT"
          }
        },
        include: {broadcast: true}
      });

      if (broadcastRecipient) {
        // Create a "sent" metric record
        await prisma.broadcastMetric.create({
          data: {
            broadcastId: broadcastRecipient.broadcastId,
            metricType: "sent",
            metricValue: 1,
            contactId: contact.id,
            timestamp: new Date()
          }
        });

        // Update broadcast sent count
        await prisma.broadcast.update({
          where: {id: broadcastRecipient.broadcastId},
          data: {
            totalSent: {
              increment: 1
            }
          }
        });
      }
    }
  } catch (error) {
    console.error("Error processing message echoes:", error);
  }
};

export const processBroadcastInteraction = async (messageData: any) => {
  try {
    const {messages, statuses} = messageData;

    // Process message replies for broadcast tracking
    if (messages && Array.isArray(messages)) {
      for (const message of messages) {
        const {from: phoneNumber, context} = message;

        // Check if this is a reply to a broadcast template
        if (context && context.referred_product) {
          const contact = await prisma.contact.findFirst({
            where: {phoneNumber}
          });

          if (contact) {
            // Find recent broadcast recipient
            const recentBroadcast = await prisma.broadcastRecipient.findFirst({
              where: {
                contactId: contact.id,
                createdAt: {
                  gte: new Date(Date.now() - 24 * 60 * 60 * 1000) // Last 24 hours
                }
              },
              include: {broadcast: true},
              orderBy: {createdAt: 'desc'}
            });

            if (recentBroadcast) {
              // Check if this reply metric already exists for this broadcast and contact
              const existingReplyMetric = await prisma.broadcastMetric.findFirst({
                where: {
                  broadcastId: recentBroadcast.broadcastId,
                  contactId: contact.id,
                  metricType: "replied"
                }
              });

              // Only create metric if it doesn't already exist
              if (!existingReplyMetric) {
                // Record reply metric
                await prisma.broadcastMetric.create({
                  data: {
                    broadcastId: recentBroadcast.broadcastId,
                    metricType: "replied",
                    metricValue: 1,
                    contactId: contact.id,
                    timestamp: new Date()
                  }
                });

                // Update broadcast reply count
                await prisma.broadcast.update({
                  where: {id: recentBroadcast.broadcastId},
                  data: {
                    totalReplied: {
                      increment: 1
                    }
                  }
                });
                
              }
            }
          }
        }
      }
    }

    // Process message status updates (delivered, read)
    if (statuses && Array.isArray(statuses)) {
      for (const status of statuses) {
        const {recipient_id: phoneNumber, status: messageStatus, errors: messageError} = status;

        const contact = await prisma.contact.findFirst({
          where: {phoneNumber}
        });

        if (contact) {
          const recentBroadcast = await prisma.broadcastRecipient.findFirst({
            where: {
              contactId: contact.id,
              createdAt: {
                gte: new Date(Date.now() - 24 * 60 * 60 * 1000)
              }
            },
            include: {broadcast: true},
            orderBy: {createdAt: 'desc'}
          });

          if (recentBroadcast) {
            let metricType = "";
            switch (messageStatus) {
              case "sent":
                metricType = "sent";
                break;
              case "delivered":
                metricType = "delivered";
                break;
              case "read":
                metricType = "read";
                break;
              default:
                metricType = "failed"
            }

            // Check if this metric already exists for this broadcast, contact, and metric type
            const existingMetric = await prisma.broadcastMetric.findFirst({
              where: {
                broadcastId: recentBroadcast.broadcastId,
                contactId: contact.id,
                metricType
              }
            });

            // Only create metric if it doesn't already exist
            if (!existingMetric) {
              // Record status metric
              await prisma.broadcastMetric.create({
                data: {
                  broadcastId: recentBroadcast.broadcastId,
                  metricType,
                  metricValue: 1,
                  contactId: contact.id,
                  timestamp: new Date()
                }
              });

              // Update broadcast counts only when creating new metric
              const updateData: any = {};
              if (metricType === "sent") {
                updateData.totalSent = {increment: 1};
              } else if (metricType === "delivered") {
                updateData.totalDelivered = {increment: 1};
              } else if (metricType === "read") {
                updateData.totalRead = {increment: 1};
              }

              await prisma.broadcast.update({
                where: {id: recentBroadcast.broadcastId},
                data: updateData
              });
            }

            // Update BroadcastRecipient status
            const recipientStatus = messageStatus.toUpperCase();
            
            console.log('Recipient Name:', contact.name || contact.phoneNumber);
            console.log('Recipient Status:', recipientStatus);
            console.log('Message Error', messageError);
            
            // Only save error messages if the status is actually failed
            const errorData = messageStatus === 'failed' && Array.isArray(messageError) && messageError.length > 0
              ? {errorMessage: messageError.map(error => `${error.title}: ${error.message}`).join(', ')}
              : {};
            
            console.log('Error Data', errorData);
            await prisma.broadcastRecipient.update({
              where: {
                id: recentBroadcast.id,
                contactId: contact.id
              },
              data: {
                status: recipientStatus,
                ...errorData
              }
            });

            // Update the message brodcastStatus
            const templateMessage = await prisma.message.findFirst({
              where: {
                contactId: contact.id,
                messageType: "template",
                text: "Template: " + recentBroadcast.broadcast.templateName 
              },
              orderBy: {
                createdAt: 'desc'
              }
            });

            if (templateMessage) {
              await prisma.message.update({
                where: {id: templateMessage.id},
                data: {
                  brodcastStatus: recipientStatus
                }
              });
            }
          }
        }
      }
    }
  } catch (error) {
    console.error("Error processing broadcast interaction:", error);
  }
};
