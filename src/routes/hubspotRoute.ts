import express from 'express';
import hubspotController from '../controllers/hubspotController';
import { authenticateJWT } from '../middlewares/authMiddleware'; // Using your existing auth middleware

const router = express.Router();

// Apply auth middleware to all routes
router.use(authenticateJWT);

// HubSpot integration routes
router.post('/verify', hubspotController.verifyConnection);
router.post('/api-key', hubspotController.updateApiKey);
router.post('/contacts', hubspotController.createContact);
router.get('/contacts/:email', hubspotController.getContactByEmail);
router.post('/send-whatsapp', hubspotController.sendWhatsAppMessage);
router.get('/status', hubspotController.getIntegrationStatus);

export default router; 