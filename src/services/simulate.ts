import { Router, Request, Response } from 'express';
import axios from 'axios';
import dayjs from 'dayjs';

const router = Router();

/**
 * 模拟预期最低价格的交易
 */
router.get('/', async (req: Request, res: Response) => {
  if (!req.query.start) return res.status(400).json({ errMessage: 'Missing start parameter' });
  if (!req.query.end) return res.status(400).json({ errMessage: 'Missing end parameter' });
  if (!req.query.principal) return res.status(400).json({ errMessage: 'Missing principal parameter' });
  if (!req.query.interval && !(req.query.start_interval && req.query.end_interval)) {
    return res.status(400).json({ errMessage: 'Missing interval (Or both start_interval, end_interval) parameter' });
  }
  if (!req.query.floor_price) return res.status(400).json({ errMessage: 'Missing floor_price parameter' });

  // 开始日期和结束日期 (格式: YYYY-MM-DD)
  const start = String(req.query.start ?? '');
  const end = String(req.query.end ?? '');
  const duration = dayjs(`${end}`).diff(dayjs(`${start}`), 'day');

  // 本金 (BUSD)
  const principal = Number(req.query.principal);
  // 总资产 (BUSD) = 本金 + 2 倍杠杆
  const totalAsset = Math.floor(principal * 3);

  // 交易间隔 (BUSD)
  const interval = Number(req.query.interval);
  const startInterval = Number(req.query.start_interval);
  const endInterval = Number(req.query.end_interval);
  // 预期最低价格 (BUSD)
  const floorPrice = Number(req.query.floor_price);

  // 获取 K 线数据
  const { data } = await axios.get('http://localhost:18700/klines', { params: { from: start, to: end } });
  const klines = data.klines as KlineRow[];

  // 为了保证随机性和策略的公平性, 建仓价格 (BUSD) = 向下取整数 (第一根 K 线的开盘价 - 1)
  const startPrice = Math.floor(klines[0][1] - 1);
  // 最大亏损差额 (BUSD) = 建仓价格 - 预期最低价格
  const deficit = startPrice - floorPrice;

  // 模拟交易
  const summaries = [];
  if (interval) {
    const summary = startGridSimulate(klines, startPrice, interval, deficit, totalAsset, duration);
    summaries.push(summary);
  } else {
    for (let i = startInterval; i <= endInterval; i++) {
      const summary = startGridSimulate(klines, startPrice, i, deficit, totalAsset, duration);
      // @ts-ignore
      delete summary.transaction;
      summaries.push(summary);
    }
  }

  return res.json({
    params: {
      start: `${start} 08:00:00`,
      end: `${end} 08:00:00`,
      duration: `${duration} 天`, // 🧮
      principal: `${principal} BUSD`,
      totalAsset: `${totalAsset} BUSD`, // 🧮
      startPrice: `${startPrice} BUSD`, // 🧮
      floorPrice: `${floorPrice} BUSD`,
      deficit: `${deficit} BUSD`, // 🧮
      interval: interval ? `${interval} BUSD` : `${startInterval} ~ ${endInterval} BUSD`
    },
    summaries
  });
});

const startGridSimulate = (
  klines: KlineRow[],
  startPrice: number,
  interval: number,
  deficit: number,
  totalAsset: number,
  duration: number
) => {
  // 仓位数量 = 浮动价格 / 交易间隔
  const positionCount = Math.floor(deficit / interval);
  // 仓位数额 (BUSD) = 总资产 / 仓位数量
  const positionAmount = Math.floor(totalAsset / positionCount);

  const transaction = gridSimulate(klines, startPrice, interval, positionAmount);
  return {
    interval: `${interval} BUSD`,
    positionCount,
    positionAmount: `${positionAmount} BUSD`,
    ...summary(transaction, duration, deficit)
  };
};

/**
 * K 线数据转换为对象格式
 * @param kline K 线数据
 */
const getKlineBaseObject = (kline: KlineRow): KlineBase => {
  const [startTime, open, high, low, close] = kline;
  return {
    startTime,
    open,
    high,
    low,
    close
  };
};

/**
 * 模拟网格交易
 * @param klines K 线数据
 * @param startPrice 建仓价格 (BUSD)
 * @param deficit 最大浮动亏损 (BUSD)
 * @param interval 交易间隔 (BUSD)
 * @param positionAmount 仓位数额 (BUSD)
 */
const gridSimulate = (klines: KlineRow[], startPrice: number, interval: number, positionAmount: number) => {
  // 交易记录
  const transaction: Transaction[] = [];

  // 下一次买入价格
  let nextBuyPrice = startPrice;

  /**
   * 遍历 K 线数据
   * 每分钟只进行一次买入交易, 卖出交易不受限制
   */
  klines.forEach(kline => {
    const timestamp = kline[0];
    const high = kline[2];
    const low = kline[3];
    const close = kline[4];

    // 最低价小于预期买入价格才能买入
    if (low < nextBuyPrice) {
      const rate = parseFloat((positionAmount / nextBuyPrice).toFixed(2));
      transaction.push({
        meta: {
          amount: positionAmount,
          rate,
          profit: parseFloat((rate * (close - nextBuyPrice)).toFixed(2))
        },
        buy: {
          price: nextBuyPrice,
          timestamp,
          time: dayjs(timestamp).format('YYYY-MM-DD HH:mm:ss'),
          kline: getKlineBaseObject(kline)
        }
      });
      // 买入后, 下一次买入价格 = 当前买入价格 - 交易间隔
      nextBuyPrice -= interval;
    }

    // 检查所有仓位是否有卖出机会
    transaction.forEach(trade => {
      // 如果已经卖出、或者刚刚买入, 则跳过
      if (trade.sell || trade.buy.timestamp === timestamp) return;
      // 最高价大于预期卖出价格才能卖出
      const sellPrice = trade.buy.price + interval;
      if (high > sellPrice) {
        trade.meta.profit = parseFloat((trade.meta.rate * interval).toFixed(2));
        trade.sell = {
          price: sellPrice,
          timestamp,
          time: dayjs(timestamp).format('YYYY-MM-DD HH:mm:ss'),
          kline: getKlineBaseObject(kline)
        };
        // 卖出后, 下一次买入价格 = 当前卖出价格 - 交易间隔
        nextBuyPrice = sellPrice - interval;
      } else {
        // 如果没有卖出则根据收盘价格计算收益
        trade.meta.profit = parseFloat((trade.meta.rate * (close - trade.buy.price)).toFixed(2));
      }
    });
  });

  return transaction;
};

/**
 * 统计交易结果
 * @param transaction 交易记录
 * @param duration 交易时长 (天)
 */
const summary = (transaction: Transaction[], duration: number, deficit: number) => {
  // 交易次数
  const count = transaction.length;
  // 已完成交易次数
  const completedCount = transaction.filter(trade => trade.sell).length;
  // 未完成交易次数
  const uncompletedCount = count - completedCount;

  // 已完成收益 (CNY)
  const completedProfit = parseFloat(
    (transaction.filter(trade => trade.sell).reduce((total, trade) => total + trade.meta.profit, 0) * 7.1).toFixed(2)
  );
  // 未完成收益 (CNY)
  const uncompletedProfit = parseFloat(
    (transaction.filter(trade => !trade.sell).reduce((total, trade) => total + trade.meta.profit, 0) * 7.1).toFixed(2)
  );

  return {
    summary: {
      count: `${count} 笔`,
      completedCount: `${completedCount} 笔`,
      completedProfit: `${completedProfit} 元`,
      uncompletedCount: `${uncompletedCount} 笔`,
      uncompletedProfit: `${uncompletedProfit} 元`,
      totalProfit: `${parseFloat((completedProfit + uncompletedProfit).toFixed(2))} 元`,
      averageProfit: `${parseFloat(((completedProfit + uncompletedProfit) / duration).toFixed(2))} 元/天`
    },
    transaction
  };
};

export default router;
