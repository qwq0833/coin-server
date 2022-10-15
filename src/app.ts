import express, { Request, Response } from 'express';
import KlinesService from './services/klines';

const app = express();
const port = 18700;

app.get('/', (req: Request, res: Response) => {
  res.json({
    message: 'Hello Coin Server!'
  });
});

app.use('/klines', KlinesService);

app.listen(port, () => {
  console.log(`⚡️[server]: Server is running at http://localhost:${port}`);
});
