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

// app.post('/nodes', async (req: Request, res: Response) => {
//   const { chat_id, node_id, data }: NodeData = req.body;
//   try {
//     const insertQuery = `INSERT INTO nodes (chat_id, node_id, data) VALUES ($1, $2, $3) RETURNING *`;
//     const values = [chat_id, node_id, data];
//     const result = await pool.query(insertQuery, values);
//     res.status(201).json(result.rows[0]);
//   } catch (error: unknown) {
//     console.error(error);
//     if (error instanceof Error) {
//       res.status(500).send(error.message);
//     } else {
//       res.status(500).send('An unknown error occurred.');
//     }
//   }
// });
// app.get('/nodes', async (req: Request, res: Response) => {
//   const { chatId, id } = req.query;

//   try {
//     let selectQuery = '';
//     let values = [];

//     if (chatId) {
//       selectQuery = `SELECT * FROM nodes WHERE chat_id = $1`;
//       values = [chatId];
//     } else if (id) {
//       selectQuery = `SELECT * FROM nodes WHERE id = $1`;
//       values = [id];
//     } else {
//       res.status(400).send('Missing query parameter');
//       return;
//     }

//     const result = await pool.query(selectQuery, values);
//     res.status(200).json(result.rows);
//   } catch (error: unknown) {
//     console.error(error);
//     if (error instanceof Error) {
//       res.status(500).send(error.message);
//     } else {
//       res.status(500).send('An unknown error occurred.');
//     }
//   }
// });

// app.get('/nodes/first', async (req: Request, res: Response) => {
//   try {
//     const selectQuery = `SELECT id FROM nodes ORDER BY id LIMIT 1`;
//     const result = await pool.query(selectQuery);

//     if (result.rows.length === 0) {
//       res.status(404).send('No nodes found');
//       return;
//     }

//     const firstRowId = result.rows[0].id;
//     res.status(200).json({ id: firstRowId });
//   } catch (error: unknown) {
//     console.error(error);
//     if (error instanceof Error) {
//       res.status(500).send(error.message);
//     } else {
//       res.status(500).send('An unknown error occurred.');
//     }
//   }
// });
// app.delete('/nodes/:chat_id', async (req: Request, res: Response) => {
//   const { chat_id } = req.params;
//   try {
//     const deleteQuery = `DELETE FROM nodes WHERE chat_id = $1`;
//     const values = [chat_id];
//     const result = await pool.query(deleteQuery, values);

//     if (result.rowCount === 0) {
//       return res.status(404).send('No nodes found with the specified chat_id');
//     }

//     res.status(200).send(`Nodes with chat_id ${chat_id} were successfully deleted.`);
//   } catch (error: unknown) {
//     console.error(error);
//     if (error instanceof Error) {
//       res.status(500).send(error.message);
//     } else {
//       res.status(500).send('An unknown error occurred.');
//     }
//   }
// });

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
