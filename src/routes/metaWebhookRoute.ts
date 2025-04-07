import express from 'express';
import { handleIncomingMessage, webhookVerification} from '../controllers/metaWebhookController';

const router = express.Router();

router.get('/', webhookVerification);
router.post('/', handleIncomingMessage);

export default router;
