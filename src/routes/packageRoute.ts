import { Router } from 'express';
import { packageController } from '../controllers/packageController';
import { authenticateJWTWithoutSubscription } from '../middlewares/authMiddleware';

const router = Router();

// Get all available packages
router.get('/available', authenticateJWTWithoutSubscription, packageController.getAvailablePackages);

// Get specific package by name
router.get('/:packageName', authenticateJWTWithoutSubscription, packageController.getPackageByName);

export default router; 