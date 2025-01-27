import express from 'express';
import { fileList, modifySpreadsheet } from '../controllers/gdriveController';
import { authenticateJWT } from '../middlewares/authMiddleware';

const router = express.Router();
router.get('/fileList',authenticateJWT, fileList);
router.post("/modifySpreadsheet",authenticateJWT, modifySpreadsheet);
export default router;
