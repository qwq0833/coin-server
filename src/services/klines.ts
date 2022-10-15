import { Router, Request, Response } from 'express';
import axios, { AxiosError } from 'axios';
import AdmZip from 'adm-zip';
import path from 'path';
import fs from 'fs/promises';
import dayjs from 'dayjs';

const router = Router();

/**
 * 获取 K 线数据
 * @param date 日期, 格式: YYYY-MM-DD
 */
const getKlines = async (date: string) => {
  try {
    const filename = `ETHBUSD-1m-${date}`;
    const cachePath = path.join(__dirname, '..', '..', 'cache', `${filename}.json`);
    let klines;

    // 优先从缓存中读取
    try {
      const data = await fs.readFile(cachePath);
      klines = JSON.parse(data.toString());
    } catch (error) {
      const remoteUrl = `https://data.binance.vision/data/spot/daily/klines/ETHBUSD/1m/${filename}.zip`;
      const remoteZip = await axios.get(remoteUrl, {
        responseType: 'arraybuffer'
      });

      // 从压缩包中读取数据
      const zip = new AdmZip(remoteZip.data);
      const csv = zip.getEntry(`${filename}.csv`);

      // K 线数据不存在
      if (!csv) {
        return null;
      }

      const data = zip.readAsText(csv);
      klines = data.split('\n').map(line => line.split(',').map(item => parseFloat(item)));

      // 写到缓存文件
      await fs.writeFile(cachePath, JSON.stringify(klines));
    }

    return klines;
  } catch (error) {
    if (error instanceof AxiosError && error.response?.status === 404) {
      return null;
    }
    return Promise.reject(error);
  }
};

router.get('/', async (req: Request, res: Response) => {
  const from = String(req.query.from ?? '');
  if (!from) {
    return res.status(400).json({ errMessage: 'Missing from parameter' });
  }

  try {
    const fromTimestamp = new Date(from).getTime();

    // 结束日期为空时, 默认等于开始日期
    const to = String(req.query.to ?? '');
    const toTimestamp = to ? new Date(to).getTime() : fromTimestamp;
    const toDay = dayjs(toTimestamp);

    // 从开始日期开始获取 K 线数据
    let currentDay = dayjs(fromTimestamp);
    const klines: any = [];

    while (!currentDay.isAfter(toDay)) {
      const data = await getKlines(currentDay.format('YYYY-MM-DD'));
      if (!data) {
        return res.status(404).json({ errMessage: 'Not Found' });
      }
      klines.push(...data);

      // 更新下一天的日期
      currentDay = currentDay.add(1, 'day');
    }

    return res.json({ klines });
  } catch (error) {
    res.status(500).json({ errMessage: 'Internal Server Error' });
  }
});

export default router;
