import express from 'express';
import { fileList, modifySpreadsheet, getSheetNames } from '../controllers/gdriveController';
import { authenticateJWT } from '../middlewares/authMiddleware';

const router = express.Router();
router.get('/fileList',authenticateJWT, fileList);
router.post("/modifySpreadsheet",authenticateJWT, modifySpreadsheet);
router.get("/sheets/:spreadsheetId", authenticateJWT, getSheetNames);
export default router;
