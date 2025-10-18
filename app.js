// app.js - PWA client-side
const API_KEY = "83d11c61e23b411fb4ecf6806e6457b2"; // <-- metti qui la tua key TwelveData o simile
const API_PROVIDER = "TWD"; // per chiarezza (Twelve Data)
const chartCtx = document.getElementById("chart").getContext("2d");
let chart;

// UI refs
const symbolEl = document.getElementById("symbol");
const intervalEl = document.getElementById("interval");
const refreshBtn = document.getElementById("refresh");
const autoBtn = document.getElementById("auto");
const lastPriceEl = document.getElementById("lastPrice");
const signalEl = document.getElementById("signal");
const rsiEl = document.getElementById("rsi");
const logList = document.getElementById("logList");

let autoRunning = false;
let timer = null;

// small util
function log(msg) {
  const li = document.createElement("li");
  li.textContent = `${new Date().toLocaleTimeString()} — ${msg}`;
  logList.prepend(li);
}

// EMA implementation
function ema(values, period) {
  if (values.length < period) return [];
  const k = 2 / (period + 1);
  let emaArray = [];
  let prev = values.slice(0, period).reduce((a,b) => a + b, 0) / period; // SMA for first
  emaArray[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    emaArray[i] = prev;
  }
  return emaArray;
}

// RSI implementation
function rsi(values, period = 14) {
  if (values.length < period + 1) return [];
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i-1];
    if (diff >= 0) gains += diff; else losses += Math.abs(diff);
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  let rsiArray = [];
  let rs = avgGain / (avgLoss || 1e-9);
  rsiArray[period] = 100 - (100 / (1 + rs));
  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i-1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? Math.abs(diff) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    rs = avgGain / (avgLoss || 1e-9);
    rsiArray[i] = 100 - (100 / (1 + rs));
  }
  return rsiArray;
}

// fetch candles from Twelve Data (esempio) - adattalo se usi altra API
async function fetchCandles(symbol, interval, output = 200) {
  // Twelve Data expects symbols like "EUR/USD" or "BTC/USD" depending on provider; adjust if needed
  // Example endpoint (Twelve Data):
  const sdSymbol = symbol === "EURUSD" ? "EUR/USD" : (symbol === "BTCUSD" ? "BTC/USD" : symbol);
  const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(sdSymbol)}&interval=${interval}&outputsize=${output}&format=JSON&apikey=${API_KEY}`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (data.status === "error") throw new Error(data.message || JSON.stringify(data));
    // data.values: array with most recent first
    const reversed = data.values.slice().reverse(); // oldest -> newest
    const close = reversed.map(c => parseFloat(c.close));
    const times = reversed.map(c => c.datetime);
    return { close, times, raw: reversed };
  } catch (e) {
    log("Errore fetch: " + e.message);
    throw e;
  }
}

// compute indicators and detect simple signal
function analyze(close) {
  const emaShort = ema(close, 12);
  const emaLong = ema(close, 26);
  const rsiArr = rsi(close, 14);

  const lastIndex = close.length - 1;
  const lastPrice = close[lastIndex];
  const lastEMA12 = emaShort[lastIndex] ?? null;
  const lastEMA26 = emaLong[lastIndex] ?? null;
  const lastRSI = rsiArr[lastIndex] ?? null;

  let sig = "—";
  // simple rule: EMA12 crosses above EMA26 and RSI < 70 -> CALL
  if (lastEMA12 && lastEMA26) {
    if (lastEMA12 > lastEMA26 && lastRSI && lastRSI < 70) sig = "CALL";
    if (lastEMA12 < lastEMA26 && lastRSI && lastRSI > 30) sig = "PUT";
  }
  return { lastPrice, lastEMA12, lastEMA26, lastRSI, sig, emaShort, emaLong, rsiArr };
}

function renderChart(times, close, emaS, emaL) {
  const labels = times.map(t => new Date(t).toLocaleTimeString());
  const datasets = [{
    label: "Close",
    data: close,
    borderWidth: 1,
    fill: false,
    tension: 0.1
  }];
  if (emaS) datasets.push({ label: "EMA12", data: emaS, borderDash: [5,2] });
  if (emaL) datasets.push({ label: "EMA26", data: emaL, borderDash: [2,2] });

  if (chart) chart.destroy();
  chart = new Chart(chartCtx, {
    type: 'line',
    data: { labels, datasets },
    options: { animation: false, responsive: true, maintainAspectRatio: false }
  });
}

async function updateNow() {
  const symbol = symbolEl.value;
  const interval = intervalEl.value;
  try {
    log(`Fetch ${symbol} ${interval}`);
    const { close, times } = await fetchCandles(symbol, interval);
    const result = analyze(close);
    lastPriceEl.textContent = `Prezzo: ${result.lastPrice?.toFixed(6) ?? "—"}`;
    signalEl.textContent = `Segnale: ${result.sig}`;
    rsiEl.textContent = `RSI: ${result.lastRSI ? result.lastRSI.toFixed(2) : "—"}`;
    renderChart(times, close, result.emaShort, result.emaLong);

    // notify if signal present
    if (result.sig === "CALL" || result.sig === "PUT") {
      notifyUser(`${result.sig} su ${symbol}`, `Prezzo ${result.lastPrice.toFixed(6)} • RSI ${result.lastRSI?.toFixed(1)}`);
      log(`Segnale: ${result.sig} • ${symbol}`);
    }
  } catch (e) {
    log("Errore update: " + e.message);
  }
}

// Notifications
async function notifyUser(title, body) {
  if (!("Notification" in window)) return;
  if (Notification.permission === "granted") {
    new Notification(title, { body });
  } else {
    const p = await Notification.requestPermission();
    if (p === "granted") new Notification(title, { body });
  }
}

// event handlers
refreshBtn.addEventListener("click", () => updateNow());
autoBtn.addEventListener("click", () => {
  autoRunning = !autoRunning;
  autoBtn.textContent = autoRunning ? "Auto stop" : "Auto start";
  if (autoRunning) {
    updateNow();
    timer = setInterval(updateNow, 60_000); // ogni minuto
  } else {
    clearInterval(timer);
  }
});

// initial run
window.addEventListener("load", () => {
  updateNow();
});
