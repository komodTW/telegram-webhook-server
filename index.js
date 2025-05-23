const express = require("express");
const fetch = require("node-fetch");
const app = express();
const jobCache = {}; // 🔁 Job 快取資料池
const jobList = {}; // 新增 job 清單快取，每位使用者的預約單列表
app.use(express.json());

const TELEGRAM_BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;

const notifiedJobs = []; // 🔁 陣列版本，只保留最近 10 筆
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
🍺 *${job.fare.toLocaleString("en-US")}*
📲  ${canTakeTime}
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
      const userId = job.userId;

      // ⚠️ 防呆檢查
      if (!userId) {
        console.log("❌ 錯誤：job.userId 為空，jobId=" + job.jobId);
        continue;
      }

      // ✅ 字串轉毫秒時間
      if (job.canTakeTime && typeof job.canTakeTime === "string") {
        const parsed = new Date(job.canTakeTime);
        job.canTakeTime = isNaN(parsed.getTime()) ? null : parsed.getTime();
      }

      const jobKey = JSON.stringify({
        jobId: job.jobId,
        bookingTime: job.bookingTime,
        fare: job.fare,
        on: job.on,
        off: job.off,
        note: job.note,
        extra: job.extra,
      });

      if (notifiedJobs.includes(job.jobId)) {
        console.log(`🔁 略過重複通知 jobId=${job.jobId}`);
        continue;
      }
      notifiedJobs.push(job.jobId);
      if (notifiedJobs.length > 30) notifiedJobs.shift(); // 可拉高儲存上限

      // ✅ 金額篩選
      const minFare = userSettings[userId]?.minFare ?? 1;
      if (job.fare < minFare) {
        console.log(`⛔️ 金額不符篩選條件（${job.fare} < ${minFare}），略過 jobId=${job.jobId}`);
        continue;
      }

      // ✅ 顯示預約單內容
      console.log("📌 預約單資訊");
      console.log(`🆔 使用者 ID: ${userId}`);
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

      // ✅ 寫入 jobList 給 job_panel（不重複）
      jobCache[job.jobId] = job;
      if (!jobList[userId]) jobList[userId] = [];

      const exists = jobList[userId].some(j => j.jobId === job.jobId);
      if (!exists) {
        jobList[userId].unshift(job);
        if (jobList[userId].length > 10) jobList[userId].pop();
      }
    }

    res.send("✅ 成功發送通知");
  } catch (e) {
    console.error("❌ 錯誤：", e.message);
    res.status(500).send("❌ Server 錯誤");
  }
});

// ✅ 設定使用者金額條件（獨立 API）
app.post("/user-settings", async (req, res) => {
  const { userId, minFare } = req.body;

  console.log("📥 收到設定請求：", req.body);

  if (!userId) {
    console.error("❌ [設定] 缺少 userId，無法儲存");
    return res.status(400).send("❌ 缺少 userId");
  }

  try {
    if (minFare === null || minFare === undefined) {
      delete userSettings[userId];
      console.log(`🔁 [${userId}] 恢復預設金額`);
    } else {
      userSettings[userId] = { minFare };
      console.log(`✅ [${userId}] 金額設定為：$${minFare}`);
    }

    // ✅ 傳送 Telegram 通知（只含金額）
    const message = minFare === null || minFare === undefined
      ? `🔁 使用者 ${userId} 恢復預設金額`
      : `✅ 使用者 ${userId} 設定金額為：$${minFare}`;

    const tgRes = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text: message
      }),
    });

    const tgJson = await tgRes.json();
    if (!tgJson.ok) {
      console.error("❌ Telegram 傳送失敗：", tgJson.description);
    }

    res.send("✅ 設定完成");
  } catch (e) {
    console.error("❌ [設定] 錯誤：", e.message);
    res.status(500).send("❌ 設定處理失敗");
  }
});

// ✅ job_panel 專用資料來源（已同步篩選邏輯）
app.get("/pp/view", (req, res) => {
  const userId = req.query.userId;
  const jobs = jobList[userId] || [];

  const formatDateTime = (ts) => {
    const date = new Date(ts);
    const MM = String(date.getMonth() + 1).padStart(2, "0");
    const DD = String(date.getDate()).padStart(2, "0");
    const HH = String(date.getHours()).padStart(2, "0");
    const mm = String(date.getMinutes()).padStart(2, "0");
    return `${MM}/${DD} ${HH}:${mm}`;
  };

  const formatTimeOnlyWithMs = (ts) => {
    const date = new Date(ts);
    const HH = String(date.getHours()).padStart(2, "0");
    const mm = String(date.getMinutes()).padStart(2, "0");
    const ss = String(date.getSeconds()).padStart(2, "0");
    const ms = String(date.getMilliseconds()).padStart(3, "0");
    return `${HH}:${mm}:${ss}.${ms}`;
  };

  const now = Date.now();
  const formatted = jobs.map(job => ({
    jobId: job.jobId,
    fare: job.fare,
    on: job.on,
    off: job.off,
    note: job.note || "無",
    extra: job.extra || "無",
    bookingTime: formatDateTime(job.bookingTime),
    canTakeTime: formatTimeOnlyWithMs(job.canTakeTime),
    countdown: job.countdown, // ✅ 直接用原始值，不再換算
  }));

  res.json(formatted);
});


// ✅ 清除 /pp/view（jobList）中所有使用者的快取資料
app.post("/pp/flush", (req, res) => {
  Object.keys(jobList).forEach(userId => {
    jobList[userId] = [];
  });

  console.log("🧹 /pp/flush 被呼叫，所有 jobList 清空");
  res.send("✅ 已清除所有使用者的預約單快取");
});


// ✅ 新增 LINE GO log 接收 API（建議放在所有 app.post() 的中段）

const LINEGO_BOT_TOKEN = process.env.LINEGO_BOT_TOKEN;
const LINEGO_CHAT_ID = process.env.LINEGO_CHAT_ID;

const notifiedLinegoJobs = {}; // { userId: [ trip_id1, trip_id2, ... ] }

app.post("/linego-log", async (req, res) => {
  try {
    const userId = req.body.userId || "default";
    const raw = req.body.raw;
    if (!raw || !raw.trip_id) return res.status(400).send("❌ 缺少 raw 或 trip_id");

    const {
      trip_id,
      start_address = "未知上車地點",
      address = "未知下車地點",
      fare_range = [],
      reserve_time,
      acceptable_time,
      notes = "",
      featureName = "無"
    } = raw;

    const fare = fare_range[0] || 0;

    // ✅ 初始化此 user 的 trip_id 記憶陣列
    if (!notifiedLinegoJobs[userId]) {
      notifiedLinegoJobs[userId] = [];
    }

    if (notifiedLinegoJobs[userId].includes(trip_id)) {
      console.log(`🔁 [${userId}] 重複預約單 trip_id=${trip_id}，略過通知`);
      return res.send("🔁 已通知過相同預約單 ID");
    }

    // ✅ 記錄此 trip_id，保留最多 10 筆
    notifiedLinegoJobs[userId].push(trip_id);
    if (notifiedLinegoJobs[userId].length > 10) {
      notifiedLinegoJobs[userId].shift();
    }

    // ✅ 時間格式化
    const formatTimeMMDD = (t) => {
      if (!t || typeof t !== "number") return "❓ 無效時間";
      const date = new Date(t * 1000);
      date.setHours(date.getHours() + 8); // 台灣時區
      const MM = String(date.getMonth() + 1).padStart(2, "0");
      const DD = String(date.getDate()).padStart(2, "0");
      const HH = String(date.getHours()).padStart(2, "0");
      const mm = String(date.getMinutes()).padStart(2, "0");
      return `${MM}/${DD} ${HH}:${mm}`;
    };

    const formatTimeWithMs = (t) => {
      if (!t || typeof t !== "number") return "❓ 無效時間";
      const date = new Date(t * 1000);
      date.setHours(date.getHours() + 8); // 台灣時區
      const HH = String(date.getHours()).padStart(2, "0");
      const mm = String(date.getMinutes()).padStart(2, "0");
      const ss = String(date.getSeconds()).padStart(2, "0");
      const ms = String(date.getMilliseconds()).padStart(3, "0");
      return `${HH}:${mm}:${ss}.${ms}`;
    };

    const reserveTimeFormatted = formatTimeMMDD(reserve_time);
    const canTakeTimeFormatted = formatTimeWithMs(acceptable_time);

    // ✅ 組合訊息
    const message = `
🟢 *$ ${fare.toLocaleString()}*
📲 *可接單時間：${canTakeTimeFormatted}*
⏳ *${reserveTimeFormatted}*
───────────────
✅ 上車：${start_address}
☑️ 下車：${address}
───────────────
📝 備註：${notes || "無"}
🔔 特殊需求：${featureName || "無"}
───────────────
`;

    // ✅ 發送通知
    await fetch(`https://api.telegram.org/bot${LINEGO_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: LINEGO_CHAT_ID,
        text: message,
        parse_mode: "Markdown"
      }),
    });

    console.log(`📨 [${userId}] LINE GO 資料已通知 Telegram：trip_id=${trip_id}`);
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

app.get("/signal/set", (req, res) => {
  const { userId, signal, jobId } = req.query;
  if (!userId || !signal) return res.status(400).send("❌ 缺少參數");

  if (signal === "accept") {
    const job = jobCache[jobId];
    if (!job) {
      console.error(`❌ 無法在 jobCache 中找到 jobId=${jobId} 的資料`);
      return res.status(400).send("❌ job 不存在");
    }

    signals[userId] = {
      ...job,
      jobId,
      userId,
      createdAt: Date.now()
    };
    console.log(`📩 [手機] 接收到接單指令：userId=${userId}, jobId=${jobId}`);

    setTimeout(() => {
      if (signals[userId]?.jobId === jobId) {
        delete signals[userId];
        console.log(`⌛ [伺服器] 手機接單訊號自動過期：userId=${userId}, jobId=${jobId}`);
      }
    }, 25000);

    return res.send("✅ 已送出接單訊號");
  }

  if (signal === "skip") {
    signals[userId] = "skip";
    console.log(`📩 [手機] 接收到略過指令：userId=${userId}`);

    setTimeout(() => {
      if (signals[userId] === "skip") {
        delete signals[userId];
        console.log(`⌛ [伺服器] 手機略過訊號自動過期：userId=${userId}`);
      }
    }, 25000);

    return res.send("✅ 已送出略過訊號");
  }

  return res.status(400).send("❌ signal 內容錯誤");
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
app.listen(PORT, async () => {
  const bootMsg = `🚀 Webhook Server 啟動成功\n📍 Port: ${PORT}\n🕒 ${new Date().toLocaleString("zh-TW")}`;
  console.log(bootMsg);

  // ✅ 發送「伺服器啟動成功」通知到 Telegram
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text: bootMsg,
      }),
    });
  } catch (e) {
    console.error("❌ 發送啟動通知失敗：", e.message);
  }

  // ✅ 每 30 分鐘監控一次記憶體用量
  setInterval(async () => {
    const memMB = process.memoryUsage().heapUsed / 1024 / 1024;
    const memStr = `📊 [記憶體監控] 當前使用：${memMB.toFixed(2)} MB\n🕒 ${new Date().toLocaleTimeString("zh-TW")}`;

    console.log(memStr);

    try {
      await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: CHAT_ID,
          text: memStr,
        }),
      });
    } catch (e) {
      console.error("❌ 發送記憶體通知失敗：", e.message);
    }
  }, 30 * 60 * 1000); // ⏱ 每 30 分鐘
});
