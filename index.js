const express = require("express");
const fetch = require("node-fetch");
const app = express();
const jobCache = {}; // 🔁 Job 快取資料池
app.use(express.json());

const TELEGRAM_BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;

const notifiedJobs = new Set();
const acceptedJobs = new Set();
const signals = {}; // { userId: { jobId, createdAt } }
const userSettings = {}; // { userId: { minFare } }

function formatCurrency(amount) {
  return `$ ${amount.toLocaleString("en-US")}`;
}
function formatDateTime(dateTime) {
  const date = new Date(dateTime);
  const MM = String(date.getMonth() + 1).padStart(2, "0");
  const DD = String(date.getDate()).padStart(2, "0");
  const HH = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${MM}/${DD} ${HH}:${mm}`;
}
function formatTimeOnlyWithMs(dateTime) {
  const date = new Date(dateTime);
  const HH = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  const ms = String(date.getMilliseconds()).padStart(3, "0");
  return `${HH}:${mm}:${ss}.${ms}`;
}

async function updateMessageText(chat_id, message_id, newText, replyMarkup) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageText`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id,
      message_id,
      text: newText,
      parse_mode: "Markdown",
      reply_markup: replyMarkup ?? undefined,
    }),
  });
}

async function sendTelegramNotification(job) {
  const fare = formatCurrency(job.fare);
  const bookingTime = formatDateTime(job.bookingTime);
  const canTakeTime = formatTimeOnlyWithMs(job.canTakeTime);
  const countdown = Math.floor(job.countdown ?? 0);
  const adjustedCountdown = Math.max(0, countdown - 3);
  const note = job.note || "無";
  const extra = job.extra || "無";

  const staticMessage = `
💰 $ *${job.fare.toLocaleString("en-US")}*
🕓 *${bookingTime}*
───────────────
🚕 ${job.on}
🛬 ${job.off}
───────────────
📝 備註：${note}
📦 特殊需求：${extra}
───────────────
🆔 用戶 ID：${job.userId}
🔖 預約單ID：${job.jobId}
📲 可接單時間: ${canTakeTime}
⏳ 倒數秒數：${countdown} 秒
───────────────`;

  const countdownLine = (sec, expired = false) => {
    if (expired) return "⛔️ *時間已截止，無法執行自動接單*";
    if (sec <= 5) return `⏳ *⛔‼️ 剩餘時間：${sec} 秒 ‼️⛔*`;
    if (sec <= 10) return `⏳ *⚠️ 剩餘時間：${sec} 秒 ⚠️*`;
    if (sec <= 20) return `⏳ *⏱ 剩餘時間：${sec} 秒*`;
    return `⏳ *剩餘時間：${sec} 秒*`;
  };

  const fullMessage = (sec, expired = false) => `${staticMessage}\n${countdownLine(sec, expired)}`;

  const getReplyMarkup = (jobId) => {
    if (acceptedJobs.has(jobId)) {
      return {
        inline_keyboard: [[{ text: "❌ 略過", callback_data: `skip_${jobId}` }]]
      };
    }
    return {
      inline_keyboard: [
        [{ text: "🚀 我要接單", callback_data: `accept_${jobId}` }],
        [{ text: "❌ 略過", callback_data: `skip_${jobId}` }],
      ]
    };
  };

  const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: CHAT_ID,
      text: fullMessage(adjustedCountdown),
      parse_mode: "Markdown",
      reply_markup: getReplyMarkup(job.jobId),
    }),
  });

  const data = await res.json();
  if (!data.ok) return console.error("❌ 發送 TG 訊息失敗：", data.description);

  const msgId = data.result.message_id;
  const updateAt = [20, 15, 10, 5];

  updateAt.forEach((sec) => {
    if (adjustedCountdown > sec) {
      const delay = (adjustedCountdown - sec) * 1000;
      setTimeout(() => {
        updateMessageText(
          CHAT_ID,
          msgId,
          fullMessage(sec),
          getReplyMarkup(job.jobId)
        );
      }, delay);
    }
  });

  if (adjustedCountdown > 0) {
    setTimeout(() => {
      updateMessageText(CHAT_ID, msgId, fullMessage(0, true));
    }, adjustedCountdown * 1000);
  }
}

// ✅ 接收 ProxyPin 資料
app.post("/pp", async (req, res) => {
  try {
    const jobs = req.body.jobs || [];
    console.log(`📥 收到 ProxyPin 的預約單，共 ${jobs.length} 筆`);

    for (const job of jobs) {
  // ✅ 將 canTakeTime 字串轉為 timestamp（毫秒）
  if (job.canTakeTime && typeof job.canTakeTime === "string") {
    const parsed = new Date(job.canTakeTime);
    if (!isNaN(parsed.getTime())) {
      job.canTakeTime = parsed.getTime(); // e.g. 1712619203207
    } else {
      console.warn("⚠️ 無法解析 canTakeTime，收到的值是：", job.canTakeTime);
      job.canTakeTime = null;
    }
  }

  jobCache[job.jobId] = job;
  const jobKey = JSON.stringify({
    jobId: job.jobId,
    bookingTime: job.bookingTime,
    fare: job.fare,
    on: job.on,
    off: job.off,
    note: job.note,
    extra: job.extra,
  });

      if (notifiedJobs.has(jobKey)) {
        console.log(`🔁 略過重複通知：${job.jobId}`);
        continue;
      }

      // 二次金額篩選（根據 userSettings）
      const minFare = userSettings[job.userId]?.minFare ?? 300;
      if (job.fare < minFare) {
        console.log(`⛔️ 金額不符篩選條件（${job.fare} < ${minFare}），略過 jobId=${job.jobId}`);
        continue;
      }

      console.log("📌 預約單資訊");
      console.log(`🆔 使用者 ID: ${job.userId}`);
      console.log(`🔖 預約單ID: ${job.jobId}`);
      console.log(`🗓️ 搭車時間: ${job.bookingTime}`);
      console.log(`📲 可接單時間: ${job.canTakeTime}`);
      console.log(`💰 車資: $${job.fare}`);
      console.log(`🚕 上車: ${job.on}`);
      console.log(`🛬 下車: ${job.off}`);
      console.log(`📝 備註: ${job.note}`);
      console.log(`📦 特殊需求: ${job.extra}`);
      console.log(`⏳ 倒數秒數: ${job.countdown} 秒`);
      console.log("──────────────────────────────");

      await sendTelegramNotification(job);
      notifiedJobs.add(jobKey);
    }

    res.send("✅ 成功發送通知");
  } catch (e) {
    console.error("❌ 錯誤：", e.message);
    res.status(500).send("❌ Server 錯誤");
  }
});

// ✅ 新增 LINE GO log 接收 API（建議放在所有 app.post() 的中段）

app.post("/linego-log", async (req, res) => {
  try {
    const raw = req.body.raw;
    if (!raw) return res.status(400).send("❌ 缺少 raw 欄位");
    console.log("📨 收到 LINE GO log：", raw);

    // 欄位預設值處理
    const {
      start_address = "未知上車地點",
      address = "未知下車地點",
      fare_range = [],
      reserve_time,
      acceptable_time,
      notes = "",
      featureName = "無"
    } = raw;

    const fare = fare_range[0] || 0;

    const formatTime = (t) => {
      if (!t || typeof t !== "number") return "❓ 無效時間";
      const date = new Date(t * 1000);
      const HH = String(date.getHours()).padStart(2, "0");
      const mm = String(date.getMinutes()).padStart(2, "0");
      const ss = String(date.getSeconds()).padStart(2, "0");
      return `${HH}:${mm}:${ss}`;
    };

    const reserveTimeFormatted = formatTime(reserve_time);
    const canTakeTimeFormatted = formatTime(acceptable_time);

    // 🧾 格式化訊息
    const message = `
💰 *$ ${fare.toLocaleString()}*
🕒 *${reserveTimeFormatted}*

🚕 *上車地點：* ${start_address}
🛬 *下車地點：* ${address}

📝 *備註：* ${notes || "無"}
📦 *特殊需求：* ${featureName || "無"}

📲 *可接單時間：* ${canTakeTimeFormatted}
🕐 *通知時間：* ${new Date().toLocaleString()}
`;

    // ✅ 傳送至 Telegram
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text: message,
        parse_mode: "Markdown"
      }),
    });

    console.log("📨 LINE GO 資料已通知 Telegram");
    res.send("✅ 成功通知 Telegram");

  } catch (e) {
    console.error("❌ /linego-log 發生錯誤：", e.message);
    res.status(500).send("❌ 錯誤");
  }
});

// ✅ 伺服器時間查詢
app.get("/now", (req, res) => {
  res.json({ now: Date.now() });
});

// ✅ AJ 輪詢訊號
app.get("/signal", (req, res) => {
  const userId = req.query.userId;
  const entry = signals[userId];

  if (!userId || !entry) return res.json({ signal: "none" });
  if (entry === "skip") return res.json({ signal: "skip" });

  return res.json({
    signal: "accept",
    ...entry
  });
});

// ✅ AJ 清除訊號
app.get("/signal/clear", (req, res) => {
  const userId = req.query.userId;
  if (signals[userId]) {
    console.log(`🧹 [AJ] 清除訊號：userId=${userId}, 原訊號=${signals[userId].jobId}`);
    delete signals[userId];
  }
  res.send("✅ 已清除訊號");
});

// ✅ TG 按鈕事件處理
app.post("/telegram-callback", async (req, res) => {
  const callback = req.body.callback_query;
  if (!callback) return res.sendStatus(400);

  const match = callback.data.match(/(accept|skip)_(.+)/);
  if (!match) return res.sendStatus(400);

const action = match[1];
const jobId = match[2];
const text = callback.message.text;
const userIdMatch = text.match(/用戶 ID：(.+)/);
const userId = userIdMatch ? userIdMatch[1].trim() : "unknown";

if (action === "accept") {
  const job = jobCache[jobId];
  if (!job) {
    console.error(`❌ 無法在 jobCache 中找到 jobId=${jobId} 的資料`);
    return res.status(400).send("❌ 資料遺失，請重新操作");
  }

  signals[userId] = {
    ...job,
    jobId,
    userId, // ✅ 額外補上 userId，避免 job 裡缺失
    createdAt: Date.now()
  };
  acceptedJobs.add(jobId);
  console.log(`📩 [TG] 使用者 ${userId} 點擊「我要接單」，jobId=${jobId}`);

  setTimeout(() => {
    if (signals[userId]?.jobId === jobId) {
      delete signals[userId];
      console.log(`⌛ [伺服器] 訊號自動過期清除：userId=${userId}, jobId=${jobId}`);
    }
  }, 25000);

} else {
  signals[userId] = "skip";
  console.log(`📩 [TG] 使用者 ${userId} 點擊「略過」，jobId=${jobId}`);

  // ✅ 新增：略過訊號也 25 秒後自動清除
  setTimeout(() => {
    if (signals[userId] === "skip") {
      delete signals[userId];
      console.log(`⌛ [伺服器] 略過訊號自動過期清除：userId=${userId}`);
    }
  }, 25000);
}

  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      callback_query_id: callback.id,
      text: action === "accept" ? "✅ 接單已送出" : "❌ 已略過",
    }),
  });

  if (action === "accept") {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageReplyMarkup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: callback.message.chat.id,
        message_id: callback.message.message_id,
        reply_markup: {
          inline_keyboard: [[{ text: "❌ 略過", callback_data: `skip_${jobId}` }]]
        }
      })
    });
  }

  res.sendStatus(200);
});

// ✅ 啟動伺服器
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("🚀 Webhook Server 啟動成功，Port:", PORT));
