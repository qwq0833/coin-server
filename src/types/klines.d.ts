// 每一行的数据拆分成数组 (开始时间戳, 开盘价, 最高价, 最低价, 收盘价, 交易量 (ETH), 结束时间戳, 交易额 (BUSD))
type KlineRow = [
  startTime: number,
  open: number,
  high: number,
  low: number,
  close: number,
  volume: number,
  endTime: number,
  amount: number
];
