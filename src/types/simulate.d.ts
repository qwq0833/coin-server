interface Transaction {
  meta: {
    // 买入数量
    amount: number;
    // 比例 (BUSD)
    rate: number;
    // 盈亏数额 (BUSD)
    profit: number;
  };
  buy: BaseTransaction;
  sell?: BaseTransaction;
}

// 基本交易信息
interface BaseTransaction {
  // 交易价格
  price: number;
  // 交易时间
  timestamp: number;
  time: string;
  // K 线数据
  kline: Kline;
}
