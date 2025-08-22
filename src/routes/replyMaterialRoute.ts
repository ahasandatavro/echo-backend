import express, { Request, Response } from 'express';
import multer from 'multer';
import axios from 'axios';
import FormData from 'form-data';
import { PrismaClient, MaterialType } from '@prisma/client';
import { checkFeatureAccess } from '../utils/packageUtils';
import { uploadFileToDigitalOceanHelper } from '../helpers';

const prisma = new PrismaClient();
const router = express.Router();

// Configure multer to use in-memory storage
const upload = multer({ storage: multer.memoryStorage() });

// Helper: Call the existing /upload endpoint to store the file in DigitalOcean Spaces
export const uploadFileToDigitalOcean = async (file: Express.Multer.File): Promise<string> => {
  try{
  const formData = new FormData();
  // Append file buffer with its original name
  formData.append('file', file.buffer, file.originalname);

  // Use an internal URL (adjust port/hostname as needed or use an env variable)
  const uploadUrl =  'https://localhost:5000/upload';

  const response = await axios.post(uploadUrl, formData, {
    headers: formData.getHeaders(),
  });

  return response.data.fileUrl;
  }
  catch(error){
      console.error("Error uploading media to DigitalOcean:", error);
      return "";
  }
};

router.get('/', async (req: Request, res: Response) => {
  const { type, search } = req.query;

  try {
    if (!type) {
      return res.status(400).json({ message: "Type parameter is required" });
    }

    let materials;

    if (type === "Notification" || type === "AssignUser" || type === "AssignTeam") {
      // ✅ Fetch from `RoutingMaterial`
      const whereClause: any = { type: type as any };
      
      // Add search filter if search parameter is provided
      if (search && typeof search === 'string') {
        whereClause.name = {
          contains: search,
          mode: 'insensitive' // Case-insensitive search
        };
      }

      materials = await prisma.routingMaterial.findMany({
        where: whereClause,
        include: {
          users: {
            select: {               // ✅ Select only required user fields
              id: true,
              email: true,
              firstName: true,
              lastName: true,
            },
          },
          assignedUser: {
            select: {               // ✅ Select only required fields
              id: true,
              email: true,
              firstName: true,
              lastName: true,
            },
          },
          team: true, // Include team for AssignTeam
        },
      });
    } else {
      // ✅ Fetch from `ReplyMaterial`
      const whereClause: any = { type: type as MaterialType };
      
      // Add search filter if search parameter is provided
      if (search && typeof search === 'string') {
        whereClause.name = {
          contains: search,
          mode: 'insensitive' // Case-insensitive search
        };
      }

      materials = await prisma.replyMaterial.findMany({
        where: whereClause,
      });
    }

    res.json(materials);
  } catch (error) {
    console.error('Error fetching materials:', error);
    res.status(500).json({ message: 'Failed to fetch materials', error });
  }
});


// GET a single reply material by ID
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const material = await prisma.replyMaterial.findUnique({ where: { id } });
    if (!material) {
      return res.status(404).json({ message: 'Reply material not found' });
    }
    res.json(material);
  } catch (error) {
    console.error('Error fetching material:', error);
    res.status(500).json({ message: 'Failed to fetch reply material', error });
  }
});

// POST create a new reply material
// Use multer middleware to accept an optional file (field name "file")
router.post('/', upload.single('file'), async (req: Request, res: Response) => {
  try {
    // ✅ Check if user is authenticated
    if (!req.user || !(req.user as any).userId) {
      return res.status(401).json({ error: "Unauthorized. User not found." });
    }

    // ✅ Check package access - only Pro and Business packages can create reply materials
    const accessCheck = await checkFeatureAccess((req.user as any).userId, 'replyMaterials');
    if (!accessCheck.allowed) {
      return res.status(403).json({
        error: "Package access denied",
        message: accessCheck.message,
        packageName: accessCheck.packageName
      });
    }

    // Expected fields in req.body: type, (name and content for TEXT type)
    const { type } = req.body;
    let content = req.body.content || null;
    let name = req.body.name || '';
    let fileUrl: string | null = null;

    // For file-based types, automatically use the file's name and upload it to DO Spaces
    if (type !== MaterialType.TEXT && type !== "CONTACT_ATTRIBUTES" && req.file) {
      name = req.file.originalname;
      //fileUrl = await uploadFileToDigitalOcean(req.file);
      fileUrl = await uploadFileToDigitalOceanHelper(req.file);
    }
    if (type === "CONTACT_ATTRIBUTES") {
      // Assume req.body.contactAttributes contains your attribute data (as JSON or a string)
      const contactAttributes = req.body.content;
      content = typeof contactAttributes === "string" ? contactAttributes : JSON.stringify(contactAttributes);
    }


    const newMaterial = await prisma.replyMaterial.create({
      data: {
        type: type as MaterialType,
        name,
        content: (type === MaterialType.TEXT|| type === "CONTACT_ATTRIBUTES") ? content : null,
        fileUrl,
      },
    });

    res.status(201).json(newMaterial);
  } catch (error) {
    console.error('Error creating material:', error);
    res.status(500).json({ message: 'Failed to create reply material', error });
  }
});

// PUT update an existing reply material
// Also use multer in case a new file is provided
router.put('/:id', upload.single('file'), async (req: Request, res: Response) => {
  try {
    // ✅ Check if user is authenticated
    if (!req.user || !(req.user as any).userId) {
      return res.status(401).json({ error: "Unauthorized. User not found." });
    }

    // ✅ Check package access - only Pro and Business packages can update reply materials
    const accessCheck = await checkFeatureAccess((req.user as any).userId, 'replyMaterials');
    if (!accessCheck.allowed) {
      return res.status(403).json({
        error: "Package access denied",
        message: accessCheck.message,
        packageName: accessCheck.packageName
      });
    }

    const id = parseInt(req.params.id);
    let { type, content } = req.body;
    let name = req.body.name || '';
    let fileUrl: string | undefined;

    // For file-based materials, if a new file is provided, update the file URL
    if (type !== MaterialType.TEXT && req.file) {
      name = req.file.originalname;
      fileUrl = await uploadFileToDigitalOcean(req.file);
    }
    if (type === "CONTACT_ATTRIBUTES"|| type === "Contact Attributes") {
      // Assume req.body.contactAttributes contains your attribute data (as JSON or a string)
      type = MaterialType.CONTACT_ATTRIBUTES;
      const contactAttributes = req.body.content;
      content = typeof contactAttributes === "string" ? contactAttributes : JSON.stringify(contactAttributes);
    }
    const updatedMaterial = await prisma.replyMaterial.update({
      where: { id },
      data: {
        type: type as MaterialType,
        name,
        //content: type === (MaterialType.TEXT || MaterialType.CONTACT_ATTRIBUTES ||"CONTACT_ATTRIBUTES") ? content : null,
        content: (
          type === MaterialType.TEXT ||
          type === MaterialType.CONTACT_ATTRIBUTES ||
          type === "CONTACT_ATTRIBUTES"
        ) ? content : null,

        ...(fileUrl && { fileUrl }),
      },
    });

    res.json(updatedMaterial);
  } catch (error) {
    console.error('Error updating material:', error);
    res.status(500).json({ message: 'Failed to update reply material', error });
  }
});

// DELETE a reply material
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    await prisma.replyMaterial.delete({ where: { id } });
    res.json({ message: 'Reply material deleted successfully' });
  } catch (error) {
    console.error('Error deleting material:', error);

    // @ts-ignore
    if (error?.meta?.constraint === 'KeywordReplyMaterial_replyMaterialId_fkey') {
      return res.status(500).json({ message: 'Reply material cannot be deleted because it is used by a keyword. Please delete the keyword first.'});
    }

    res.status(500).json({ message: 'Failed to delete reply material'});
  }
});

export default router;

