// routes/webhookRoutes.js
import express from 'express';
import {   
    createWebhook,
    getWebhooks,
    getWebhookById,
    updateWebhook,
    deleteWebhook, } from '../controllers/webhookController';
import { authenticateJWT } from '../middlewares/authMiddleware';

const router = express.Router();

// Route to create a new webhook
router.post('/', authenticateJWT, createWebhook);

router.get('/', authenticateJWT, getWebhooks);

// Get a specific webhook by ID
router.get('/:id', authenticateJWT, getWebhookById);

// Update a webhook
router.put('/:id', authenticateJWT, updateWebhook);

// Delete a webhook
router.delete('/:id', authenticateJWT, deleteWebhook);

export default router;