
import { Request, Response } from "express";
import {
  isValidWebhookRequest,
  processWebhookChange,
} from "../subProcessors/metaWebhook";

export const handleIncomingMessage = async (req: Request, res: Response) => {
  const VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN;

  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token === VERIFY_TOKEN) {
    console.log("Webhook verified");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(200);
  }
};

export const webhookVerification = async (req: Request, res: Response) => {
  try {
    const { entry } = req.body;
    const io = req.app.get("socketio");
    
    if (!isValidWebhookRequest(entry)) {
      return res.status(400).send("Invalid request");
    }

    for (const item of entry) {
      const changes = item.changes;
      if (!changes || !Array.isArray(changes)) continue;

      for (const change of changes) {
        await processWebhookChange(change, io);
      }
    }

    res.sendStatus(200);
  } catch (error) {
    console.error("Webhook processing error:", error);
    res.sendStatus(500);
  }
};

