import express, { Request, Response } from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import nodeRoutes from './routes/nodeRoute';
import authRoutes from './routes/authRoute';
import { authenticateJWT } from './utils/jwtUtils';
import passport from 'passport';
import dotenv, { config } from 'dotenv';
import "./config/passportConfig"
dotenv.config();
const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(bodyParser.json({limit: '50mb'}));
app.use(bodyParser.urlencoded({limit: "50mb", extended: true, parameterLimit:50000}));
app.use(bodyParser.text({ limit: '200mb' }));
app.use(express.json());
app.use(passport.initialize());
app.use('/auth', authRoutes);
app.use('/nodes', authenticateJWT, nodeRoutes);
app.use('/nodes', nodeRoutes);

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
