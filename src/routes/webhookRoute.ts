// routes/webhookRoutes.js
import express from 'express';
import {   
    createWebhook,
    getWebhooks,
    getWebhookById,
    updateWebhook,
    deleteWebhook,
    getWebhookLogs,
    getWebhookLogStats } from '../controllers/webhookController';
import { authenticateJWT } from '../middlewares/authMiddleware';

const router = express.Router();

// Route to create a new webhook
router.post('/', createWebhook);

router.get('/',  getWebhooks);

// Add new routes for webhook logs (must come before /:id routes)
router.get('/logs', authenticateJWT, getWebhookLogs);
router.get('/logs/stats', authenticateJWT, getWebhookLogStats);

// Get a specific webhook by ID
router.get('/:id', getWebhookById);

// Update a webhook
router.put('/:id',  updateWebhook);

// Delete a webhook
router.delete('/:id',  deleteWebhook);

export default router;