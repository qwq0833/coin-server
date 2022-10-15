import { Router, Request, Response } from 'express';
import axios, { AxiosError } from 'axios';
import AdmZip from 'adm-zip';

const router = Router();

router.get('/', async (req: Request, res: Response) => {
  const { from } = req.query;
  if (!from) {
    return res.status(400).json({ errMessage: 'Missing from parameter' });
  }

  try {
    const remoteUrl = `https://data.binance.vision/data/spot/daily/klines/ETHBUSD/1m/ETHBUSD-1m-${from}.zip`;
    const remoteZip = await axios.get(remoteUrl, {
      responseType: 'arraybuffer'
    });

    // 从压缩包中读取数据
    const zip = new AdmZip(remoteZip.data);
    const csv = zip.getEntry(`ETHBUSD-1m-${from}.csv`);

    // K 线数据不存在
    if (!csv) {
      return res.status(404).json({ errMessage: 'Not Found' });
    }

    const data = zip.readAsText(csv);
    const klines = data.split('\n').map(line => line.split(',').map(item => parseFloat(item)));

    res.json({
      klines
    });
  } catch (error) {
    if (error instanceof AxiosError && error.response?.status === 404) {
      return res.status(404).json({ errMessage: 'Not Found' });
    }
    res.status(500).json({ errMessage: 'Internal Server Error' });
  }
});

export default router;
