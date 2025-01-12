// routes/textMaterialRoutes.ts
import express from 'express';
import {
  createTextMaterial,
  getAllTextMaterials,
  updateTextMaterial,
  deleteTextMaterial,
} from '../controllers/textMaterialController';

const router = express.Router();


router.post('/', createTextMaterial);
router.get('/', getAllTextMaterials);
router.put('/:id', updateTextMaterial);
router.delete('/:id', deleteTextMaterial);

export default router;
