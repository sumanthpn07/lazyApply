import express from 'express';
import cors from 'cors';
import path from 'path';
import { config } from './config';
import apiRoutes from './api/routes';
import { logger } from './utils/logger';
import fs from 'fs';

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from public directory
app.use(express.static(path.join(__dirname, '../public')));

// API routes
app.use('/api', apiRoutes);

// Serve the main HTML file for all non-API routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Create required directories
const directories = [
  path.join(__dirname, '../data'),
  path.join(__dirname, '../data/screenshots'),
  path.join(__dirname, '../data/resumes'),
  path.join(__dirname, '../logs'),
];

for (const dir of directories) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    logger.info(`Created directory: ${dir}`);
  }
}

// Start server
app.listen(config.port, () => {
  logger.info(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   🚀 LazyApply Server Started!                           ║
║                                                           ║
║   URL: http://localhost:${config.port}                         ║
║   API: http://localhost:${config.port}/api                     ║
║                                                           ║
║   Environment: ${config.nodeEnv.padEnd(39)}║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
  `);
});

export default app;
