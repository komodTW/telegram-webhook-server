const express = require("express");
const fetch = require("node-fetch");
const app = express();
app.use(express.json());

const TELEGRAM_BOT_TOKEN = "7683067311:AAEGmT3gNK2Maoi1JKUXmRyOKbwT3OomIOk";
const CHAT_ID = "1821018340";

const notifiedJobs = new Set();
const acceptedJobs = new Set(); // 💡 記錄已接單的 jobId
const signals = {}; // { userId: "jobId" | "skip" }

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

// ✅ 發送更新訊息
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

// ✅ 發送通知
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

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const payload = {
    chat_id: CHAT_ID,
    text: fullMessage(adjustedCountdown),
    parse_mode: "Markdown",
    reply_markup: getReplyMarkup(job.jobId),
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
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

// ✅ 接收 ProxyPin
app.post("/pp", async (req, res) => {
  try {
    const jobs = req.body.jobs || [];
    for (const job of jobs) {
      const key = JSON.stringify(job);
      if (notifiedJobs.has(key)) continue;
      await sendTelegramNotification(job);
      notifiedJobs.add(key);
    }
    res.send("✅ 成功發送通知");
  } catch (e) {
    res.status(500).send("❌ 錯誤：" + e.message);
  }
});

// ✅ 伺服器即時時間
app.get("/now", (req, res) => {
  res.json({ now: Date.now() });
});

// ✅ 使用者輪詢訊號
app.get("/signal", (req, res) => {
  const userId = req.query.userId;
  const val = signals[userId];
  if (!userId || !val) return res.json({ signal: "none" });
  if (val === "skip") return res.json({ signal: "skip" });
  return res.json({ signal: "accept", jobId: val });
});

// ✅ 清除訊號（AJ主動呼叫）
app.get("/signal/clear", (req, res) => {
  const userId = req.query.userId;
  delete signals[userId];
  res.send("✅ 已清除訊號");
});

// ✅ 接收 Telegram 按鈕點擊
app.post("/telegram-callback", async (req, res) => {
  const data = req.body;
  const callback = data.callback_query;
  if (!callback) return res.sendStatus(400);

  const match = callback.data.match(/(accept|skip)_(.+)/);
  if (!match) return res.sendStatus(400);

  const action = match[1];
  const jobId = match[2];
  const text = callback.message.text;
  const userIdMatch = text.match(/用戶 ID：(.+)/);
  const userId = userIdMatch ? userIdMatch[1].trim() : "unknown";

  signals[userId] = action === "accept" ? jobId : "skip";
  if (action === "accept") acceptedJobs.add(jobId);

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
