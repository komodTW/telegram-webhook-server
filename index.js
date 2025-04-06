const express = require("express");
const fetch = require("node-fetch");
const app = express();
app.use(express.json());

const TELEGRAM_BOT_TOKEN = "7683067311:AAEGmT3gNK2Maoi1JKUXmRyOKbwT3OomIOk";
const CHAT_ID = "1821018340";

const notifiedJobs = new Set();
const signals = {}; // key: userId, value: "accept" | "skip" | null

// ✅ 格式化工具
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

// ✅ 更新 Telegram 訊息
async function updateMessageText(chat_id, message_id, newText, replyMarkup) {
  const editUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageText`;
  const payload = {
    chat_id,
    message_id,
    text: newText,
    parse_mode: "Markdown",
    reply_markup: replyMarkup ?? undefined,
  };

  try {
    const res = await fetch(editUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await res.json();
    if (!result.ok) {
      console.error("❌ 無法更新倒數訊息：", result.description);
    } else {
      console.log(`🔄 倒數更新成功 (${chat_id})`);
    }
  } catch (err) {
    console.error("❌ 更新訊息錯誤：", err.message);
  }
}

// ✅ 發送 TG 通知
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

  const replyMarkup = {
    inline_keyboard: [
      [{ text: "🚀 我要接單", callback_data: `accept_${job.jobId}` }],
      [{ text: "❌ 略過", callback_data: `skip_${job.jobId}` }],
    ],
  };

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const payload = {
    chat_id: CHAT_ID,
    text: fullMessage(adjustedCountdown),
    parse_mode: "Markdown",
    reply_markup: adjustedCountdown > 0 ? replyMarkup : undefined,
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();

    if (!data.ok) {
      console.error("❌ 無法發送 Telegram 訊息：", data.description);
      return;
    }

    console.log("✅ 成功發送 Telegram 訊息");
    const message_id = data.result.message_id;

    const updateAt = [20, 15, 10, 5];
    updateAt.forEach((sec) => {
      if (adjustedCountdown > sec) {
        const delay = (adjustedCountdown - sec) * 1000;
        setTimeout(() => {
          updateMessageText(CHAT_ID, message_id, fullMessage(sec), replyMarkup);
        }, delay);
      }
    });

    if (adjustedCountdown > 0) {
      setTimeout(() => {
        const finalText = fullMessage(0, true);
        updateMessageText(CHAT_ID, message_id, finalText, null);
      }, adjustedCountdown * 1000);
    }
  } catch (err) {
    console.error("❌ 發送 Telegram 訊息時發生錯誤：", err.message);
  }
}

// ✅ 接收 ProxyPin 資料
app.post("/pp", async (req, res) => {
  try {
    const jobs = req.body.jobs || [];
    console.log(`📥 收到來自 ProxyPin 的預約單，共 ${jobs.length} 筆`);

    for (const job of jobs) {
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

      await sendTelegramNotification(job);
      notifiedJobs.add(jobKey);
    }

    res.status(200).send("✅ 成功接收並發送通知");
  } catch (e) {
    console.error("❌ 錯誤：", e.message);
    res.status(500).send("❌ Server 錯誤");
  }
});

// ✅ 提供目前伺服器時間
app.get("/now", (req, res) => {
  res.json({ now: Date.now() });
});

// ✅ 接收 Telegram 按鈕點擊
app.post("/telegram-callback", async (req, res) => {
  const data = req.body;
  const callback = data.callback_query;
  if (!callback) return res.sendStatus(400);

  const userResponse = callback.data;
  const match = userResponse.match(/(accept|skip)_(.+)/);
  if (!match) return res.sendStatus(400);

  const action = match[1];
  const jobId = match[2];
  const text = callback.message.text;
  const userIdMatch = text.match(/用戶 ID：(.+)/);
  const userId = userIdMatch ? userIdMatch[1].trim() : "unknown";

  signals[userId] = action === "accept" ? jobId : "skip";

  // ✅ 回覆點擊訊息
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      callback_query_id: callback.id,
      text: action === "accept" ? "✅ 已送出接單訊號" : "❌ 已略過接單",
    }),
  });

  // ✅ 如果是接單，就修改按鈕為只剩略過
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

// ✅ 提供 AJ 輪詢訊號
app.get("/signal", (req, res) => {
  const userId = req.query.userId;
  const signal = signals[userId];

  if (!userId || !signal) return res.json({ signal: "none" });

  res.json({ signal, jobId: signal !== "skip" ? signal : null });
});

// ✅ 手動清除訊號（方法 A）
app.get("/signal/clear", (req, res) => {
  const userId = req.query.userId;
  delete signals[userId];
  res.send("✅ 已清除訊號");
});

// ✅ 啟動伺服器
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("🚀 Webhook Server 已啟動，Port:", PORT));
