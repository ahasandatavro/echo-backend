import express from 'express';
import { fileList } from '../controllers/gdriveController';
import { authenticateJWT } from '../middlewares/authMiddleware';

const router = express.Router();
router.get('/fileList',authenticateJWT, fileList);
export default router;
