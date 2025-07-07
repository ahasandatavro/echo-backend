// routes/webhookRoutes.js
import express from 'express';
import {   
    createWebhook,
    getWebhooks,
    getWebhookById,
    updateWebhook,
    deleteWebhook,
    getWebhookLogs,
    getWebhookLogStats,
    testWebhook } from '../controllers/webhookController';
import { authenticateJWT } from '../middlewares/authMiddleware';

const router = express.Router();

// Route to create a new webhook
router.post('/', authenticateJWT, createWebhook);

router.get('/', authenticateJWT, getWebhooks);

// Add new routes for webhook logs (must come before /:id routes)
router.get('/logs', authenticateJWT, getWebhookLogs);
router.get('/logs/stats', authenticateJWT, getWebhookLogStats);

// Test webhook endpoint
router.post('/test', authenticateJWT, testWebhook);

// Get a specific webhook by ID
router.get('/:id', authenticateJWT, getWebhookById);

// Update a webhook
router.put('/:id', authenticateJWT, updateWebhook);

// Delete a webhook
router.delete('/:id', authenticateJWT, deleteWebhook);

export default router;