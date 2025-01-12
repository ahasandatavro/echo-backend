import express from 'express';
import { handleIncomingMessage, webhookVerification} from '../controllers/webhookController';

const router = express.Router();

router.get('/', handleIncomingMessage);
router.post('/', webhookVerification);

export default router;
