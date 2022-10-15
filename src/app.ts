import express, { Request, Response } from 'express';
import path from 'path';
import fs from 'fs/promises';
import KlinesService from './services/klines';

const app = express();
const port = 18700;

/**
 * 如果存放缓存文件的目录不存在则创建
 */
const initCacheDirectory = async () => {
  const CACHE_DIR = path.join(__dirname, '..', 'cache');
  try {
    await fs.access(CACHE_DIR);
  } catch (error) {
    await fs.mkdir(CACHE_DIR);
  }
};

app.get('/', (req: Request, res: Response) => {
  res.json({
    message: 'Hello Coin Server!'
  });
});

app.use('/klines', KlinesService);

app.listen(port, () => {
  initCacheDirectory();
  console.log(`⚡️[server]: Server is running at http://localhost:${port}`);
});
