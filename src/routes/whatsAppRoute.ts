import express from "express";
import { getSignupUrl, handleCallback } from "../controllers/whatsAppController";

const router = express.Router();

// Route for starting WhatsApp Embedded Signup
router.get("/start", getSignupUrl);

// Route for handling OAuth callback
router.get("/callback", handleCallback);

export default router;
