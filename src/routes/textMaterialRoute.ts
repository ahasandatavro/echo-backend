import { Router } from 'express';
import {
  createTextMaterial,
  getAllTextMaterials,
  updateTextMaterial,
  deleteTextMaterial,
} from '../controllers/textMaterialController';

const router: Router = Router();

// Define CRUD routes
router.post('/', createTextMaterial);
router.get('/', getAllTextMaterials);
router.put('/:id', updateTextMaterial);
router.delete('/:id', deleteTextMaterial);

export default router;
