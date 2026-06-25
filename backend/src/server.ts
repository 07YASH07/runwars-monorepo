/**
 * RunWars Backend — Entry Point
 * Full implementation arrives in Phase 3 (STEP 3.1)
 */
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { claimTerritory, getAllTerritories } from './services/territoryService';

const app = express();
const PORT = process.env.PORT ?? 3000;

app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'runwars-backend', timestamp: new Date().toISOString() });
});

// -- Territory Endpoints --

app.get('/api/territory', (_req, res) => {
  try {
    const territories = getAllTerritories();
    res.json(territories);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch territories' });
  }
});

app.post('/api/territory/claim', (req, res) => {
  try {
    const { userId, color, points } = req.body;
    if (!userId || !color || !points || !Array.isArray(points)) {
      res.status(400).json({ error: 'Missing required fields or points is not an array' });
      return;
    }
    
    const territory = claimTerritory(userId, color, points);
    if (!territory) {
      res.status(400).json({ error: 'Failed to generate territory polygon (not enough points?)' });
      return;
    }
    
    res.json(territory);
  } catch (error) {
    res.status(500).json({ error: 'Failed to claim territory' });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 RunWars backend listening on port ${PORT}`);
});

export default app;
