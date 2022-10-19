import { Router, Request, Response } from 'express';
import fs from 'fs/promises';
import path from 'path';
import axios from 'axios';
import dayjs from 'dayjs';

const router = Router();

interface Args {
  start: string;
  end: string;
  duration: number;
  principal: number;
  totalAsset: number;
  interval: number;
  floorPrice: number;
  progress: number;
  strict: boolean;
  startPrice: number;
  deficit: number;
  closePrice: number;
}

interface ExArgs extends Args {
  positionCount: number;
  positionAmount: number;
}

/**
 * 模拟预期最低价格的交易
 * @query start 开始时间, 格式: YYYY-MM-DD
 * @query end 结束时间, 格式: YYYY-MM-DD
 * @query principal 本金 (BUSD)
 * @query interval 交易间隔 (BUSD) - 可选
 * @query start_interval 开始交易间隔 (BUSD) - 可选
 * @query end_interval 结束交易间隔 (BUSD) - 可选
 * @query floor_price 最低价格 (BUSD)
 * @query progress 交易进度 (0.1-1) - 可选, 默认: 1
 * @query strict 严格买入模式 (true/false) - 可选, 默认: true
 * @query charts 是否返回图表数据 (true/false) - 可选, 默认: false
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
  const duration = dayjs(`${end}`).diff(dayjs(`${start}`), 'day') + 1;

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

  // 完成度 (0.1 - 1)
  const progress = Number(req.query.progress) || 1;
  // 卖出后的下一次买入价格是否严格以买入价格为准 (默认: true)
  const strict = req.query.strict === 'false' ? false : true;

  // 获取 K 线数据
  const { data } = await axios.get('http://localhost:18700/klines', { params: { from: start, to: end } });
  const klines = data.klines as KlineRow[];

  // 为了保证随机性和策略的公平性, 建仓价格 (BUSD) = 向下取整数 (第一根 K 线的开盘价 - 1)
  const startPrice = Math.floor(klines[0][1] - 1);
  // 最大亏损差额 (BUSD) = 建仓价格 - 预期最低价格
  const deficit = startPrice - floorPrice;
  // 收盘价 (BUSD) = 最后一根 K 线的收盘价
  const closePrice = klines[klines.length - 1][4];

  const args: Args = {
    start,
    end,
    duration,
    principal,
    totalAsset,
    interval,
    floorPrice,
    progress,
    strict,
    startPrice,
    deficit,
    closePrice
  };

  // 模拟交易
  const summaries = [];
  if (interval) {
    const summary = startGridSimulate(klines, args);
    summaries.push(summary);
  } else {
    for (let i = startInterval; i <= endInterval; i++) {
      const summary = startGridSimulate(klines, { ...args, interval: i });
      // @ts-ignore
      delete summary.transaction;
      summaries.push(summary);
    }
  }

  const result = {
    params: {
      start: `${start} 08:00:00`,
      end: `${end} 08:00:00`,
      duration: `${duration} 天`, // 🧮
      principal: `${principal} BUSD`,
      totalAsset: `${totalAsset} BUSD`, // 🧮
      startPrice: `${startPrice} BUSD`, // 🧮
      closePrice: `${closePrice} BUSD`, // 🧮
      floorPrice: `${floorPrice} BUSD`,
      deficit: `${deficit} BUSD`, // 🧮
      progress: `${progress * 100}%`,
      interval: interval ? `${interval} BUSD` : `${startInterval} ~ ${endInterval} BUSD`,
      strict
    },
    summaries
  };

  if (req.query.charts === 'true') {
    const template = await fs.readFile(path.join(__dirname, '../../template/echarts.html'), 'utf-8');
    const html = template.toString();
    return res.send(html.replace("'{{ data }}'", JSON.stringify(result)));
  } else {
    return res.json(result);
  }
});

/**
 * 开始模拟网格交易
 */
const startGridSimulate = (klines: KlineRow[], args: Args) => {
  const { deficit, interval, totalAsset } = args;
  // 仓位数量 = 浮动价格 / 交易间隔
  const positionCount = Math.floor(deficit / interval);
  // 仓位数额 (BUSD) = 总资产 / 仓位数量
  const positionAmount = Math.floor(totalAsset / positionCount);
  const transaction = gridSimulate(klines, { ...args, positionCount, positionAmount });
  return {
    interval: `${interval} BUSD`,
    positionCount,
    positionAmount: `${positionAmount} BUSD`,
    ...summary(transaction, args)
  };
};

/**
 * 模拟网格交易
 */
const gridSimulate = (klines: KlineRow[], args: ExArgs) => {
  // 交易记录
  const transaction: Transaction[] = [];

  const { startPrice, positionCount, positionAmount, interval, progress, strict } = args;

  // 下一次买入价格
  let nextBuyPrice = startPrice;
  // 下一次买入价格中由买入交易决定的部分
  let nextBuyPriceBackup = startPrice;

  /**
   * 遍历 K 线数据
   * 每分钟只进行一次买入交易, 卖出交易不受限制
   */
  klines.forEach(kline => {
    const timestamp = kline[0];
    const open = kline[1];
    const high = kline[2];
    const low = kline[3];
    const close = kline[4];

    let uncompletedCount = transaction.filter(item => !item.sell).length;
    // 只要符合最低价小于预期买入价格, 且仓位数量未满则一直买入
    while (low < nextBuyPrice && uncompletedCount < positionCount) {
      // 如果预期买入价格大于开盘价, 且由买入交易决定的部分小于开盘价, 则使用买入交易决定的部分买入
      if (open <= nextBuyPrice && open >= nextBuyPriceBackup) {
        nextBuyPrice = nextBuyPriceBackup;
      }

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
      nextBuyPriceBackup = nextBuyPrice;
      uncompletedCount++;
    }

    // 检查所有仓位是否有卖出机会
    transaction.forEach(trade => {
      // 如果已经卖出、或者刚刚买入, 则跳过
      if (trade.sell || trade.buy.timestamp === timestamp) return;
      // 最高价大于预期卖出价格才能卖出
      const sellPrice = trade.buy.price + interval * progress;
      if (high > sellPrice) {
        trade.meta.profit = parseFloat((trade.meta.rate * interval * progress).toFixed(2));
        trade.sell = {
          price: sellPrice,
          timestamp,
          time: dayjs(timestamp).format('YYYY-MM-DD HH:mm:ss'),
          kline: getKlineBaseObject(kline)
        };
        // 严格模式下, 下一次买入价格 = 完整间隔的卖出价格 - 交易间隔 (即当前仓位原本的买入价格)
        // 非严格模式下, 下一次买入价格 = 当前卖出价格 - 交易间隔
        nextBuyPrice = strict ? trade.buy.price : sellPrice - interval;
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
 * @param principal 本金 (BUSD)
 */
const summary = (transaction: Transaction[], args: Args) => {
  const { principal, duration } = args;

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
  // 总收益 (CNY)
  const totalProfit = parseFloat((completedProfit + uncompletedProfit).toFixed(2));

  // 风险率 = (3 * 本金 + 总收益) / (2 * 本金)
  const riskRate = parseFloat(((3 * principal + totalProfit) / (2 * principal)).toFixed(2));
  // 总收益率 = 总收益 / 本金
  const totalProfitRate = parseFloat(((totalProfit / 7.1 / principal) * 100).toFixed(2));

  // 需要手续费的交易次数
  const feeCount = transaction.filter(trade => trade.buy.kline.open < trade.buy.price).length;

  return {
    summary: {
      count: `${count} 笔`,
      completedCount: `${completedCount} 笔`,
      uncompletedCount: `${uncompletedCount} 笔`,
      countPerday: `${Math.floor(count / duration)} 笔/天`,
      feedCount: `${feeCount} 笔`,
      totalProfit: `${totalProfit} 元`,
      completedProfit: `${completedProfit} 元`,
      uncompletedProfit: `${uncompletedProfit} 元`,
      averageProfit: `${parseFloat((totalProfit / duration).toFixed(2))} 元/天`,
      totalProfitRate: `${totalProfitRate}%`,
      averageProfitRate: `${parseFloat((totalProfitRate / duration).toFixed(2))}%/天`,
      riskRate
    },
    transaction
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

export default router;
