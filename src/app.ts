import express, { Request, Response } from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import nodeRoutes from './routes/nodeRoute';
import authRoutes from './routes/authRoute';
import { authenticateJWT } from './utils/jwtUtils';
import passport from 'passport';
import dotenv, { config } from 'dotenv';
import "./config/passportConfig";
import multer from "multer";
import AWS from "aws-sdk";
dotenv.config();
const app = express();
const PORT = process.env.PORT || 5000;
const upload = multer({
  storage: multer.memoryStorage(),
});

// Configure AWS S3 for DigitalOcean Spaces
const s3 = new AWS.S3({
  endpoint: new AWS.Endpoint(process.env.DO_SPACES_ENDPOINT || ""),
  accessKeyId: process.env.DO_SPACES_KEY|| "",
  secretAccessKey: process.env.DO_SPACES_SECRET|| "",
  region: process.env.DO_SPACES_REGION|| "",
  s3ForcePathStyle: true,
});
app.use(cors());
app.use(bodyParser.json({limit: '50mb'}));
app.use(bodyParser.urlencoded({limit: "50mb", extended: true, parameterLimit:50000}));
app.use(bodyParser.text({ limit: '200mb' }));
app.use(express.json());
app.use(passport.initialize());
app.use('/auth', authRoutes);
app.use('/nodes', authenticateJWT, nodeRoutes);
app.use('/nodes', nodeRoutes);
app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }

    const fileKey = `${Date.now()}-${req.file.originalname}`;
    const uploadParams = {
      Bucket: process.env.DO_SPACES_BUCKET || "", // Bucket name from .env
      Key: fileKey,
      Body: req.file.buffer,
      ACL: "public-read", // Make file publicly accessible
      ContentType: req.file.mimetype,
    };

    const result = await s3.upload(uploadParams).promise();

    res.status(200).json({
      message: "File uploaded successfully",
      fileUrl: result.Location,
    });
  } catch (error) {
    console.error("Error uploading file:", error);
    res.status(500).json({ message: "Failed to upload file", error });
  }
});
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
