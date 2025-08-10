import express from 'express';
import {
  getBroadcastHistory,
  getBroadcastRecipientById,
  getAllBroadcasts,
  getBroadcastById,
} from '../controllers/broadcastController';

const router = express.Router();

// Get all broadcasts with recipient information
router.get('/', getAllBroadcasts);

// Get specific broadcast with all recipient history
router.get('/:broadcastId', getBroadcastById);

// Get broadcast history for a specific contact
router.get('/:broadcastId/contact/:contactId/history', getBroadcastHistory);

// Get broadcast recipient history by recipient ID
router.get('/recipient/:recipientId/history', getBroadcastRecipientById);

export default router; 