import express from 'express';
import {updateApiKey, createContact,getContactByEmail,sendWhatsAppMessage, getIntegrationStatus, verifyConnection, initiateOAuth,handleOAuthCallback}from '../controllers/hubspotController';
import { authenticateJWT } from '../middlewares/authMiddleware';

const router = express.Router();

// Public routes (no authentication required)
router.get('/oauth/init', initiateOAuth);
router.get('/oauth/callback', handleOAuthCallback);

// Protected routes (authentication required)
router.use(authenticateJWT);
router.post('/verify', verifyConnection);
router.post('/api-key', updateApiKey);
router.post('/contacts', createContact);
router.get('/contacts/:email', getContactByEmail);
router.post('/send-whatsapp', sendWhatsAppMessage);
router.get('/status', getIntegrationStatus);

export default router;