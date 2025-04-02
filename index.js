const express = require("express");
const fetch = require("node-fetch");
const app = express();
app.use(express.json());

const TELEGRAM_BOT_TOKEN = "7683067311:AAEGmT3gNK2Maoi1JKUXmRyOKbwT3OomIOk";
const CHAT_ID = "1821018340";

const notifiedJobs = new Set(); // 防重複通知（排除 countdown）

// ✅ 金額格式（加千分位 + 空格）
function formatCurrency(amount) {
  return `$ ${amount.toLocaleString("en-US")}`;
}

// ✅ 日期時間格式（只顯示 MM/DD HH:mm）
function formatDateTime(dateTime) {
  const date = new Date(dateTime);
  const MM = String(date.getMonth() + 1).padStart(2, "0");
  const DD = String(date.getDate()).padStart(2, "0");
  const HH = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${MM}/${DD} ${HH}:${mm}`;
}

// ✅ 更新訊息文字
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
      console.log(`🔄 倒數更新成功 (${chat_id}) - ${newText.match(/\d+ 秒/)}`);
    }
  } catch (err) {
    console.error("❌ 更新訊息錯誤：", err.message);
  }
}

// ✅ 發送 Telegram 訊息
async function sendTelegramNotification(job) {
  const fare = formatCurrency(job.fare);
  const bookingTime = formatDateTime(job.bookingTime);
  const canTakeTime = new Date(job.canTakeTime).toISOString().replace("T", " ").replace("Z", "");
  const countdown = Math.floor(job.countdown ?? 0);
  const note = job.note || "無";
  const extra = job.extra || "無";

  const messageText = (sec) => `
💰 *${fare}*
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
⏳ 倒數秒數：*${sec}* 秒
`;

  const replyMarkup = {
    inline_keyboard: [
      [{ text: "🚀 我要接單", callback_data: `accept_${job.jobId}` }],
      [{ text: "❌ 略過", callback_data: `skip_${job.jobId}` }],
    ],
  };

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const payload = {
    chat_id: CHAT_ID,
    text: messageText(countdown),
    parse_mode: "Markdown",
    reply_markup: replyMarkup,
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
      if (countdown > sec) {
        const delay = (countdown - sec) * 1000;
        setTimeout(() => {
          updateMessageText(CHAT_ID, message_id, messageText(sec), replyMarkup);
        }, delay);
      }
    });

    if (countdown > 0) {
      setTimeout(() => {
        const finalText = `⛔ 時間已截止，無法接單\n\n${messageText(0)}`;
        updateMessageText(CHAT_ID, message_id, finalText, null);
      }, countdown * 1000);
    }
  } catch (err) {
    console.error("❌ 發送 Telegram 訊息時發生錯誤：", err.message);
  }
}

// ✅ 主處理邏輯
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

      console.log(`📌 預約單資訊`);
      console.log(`🆔 使用者 ID: ${job.userId}`);
      console.log(`🔖 預約單ID: ${job.jobId}`);
      console.log(`🗓️ 搭車時間: ${job.bookingTime}`);
      console.log(`⏱️ 建立時間: ${job.jobTime}`);
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

    res.status(200).send("✅ 成功接收並發送通知");
  } catch (e) {
    console.error("❌ 錯誤：", e.message);
    res.status(500).send("❌ Server 錯誤");
  }
});

// ✅ 監聽啟動（符合 Render 要求）
const PORT = process.env.PORT;
app.listen(PORT, () => console.log("🚀 Webhook Server 已啟動，Port:", PORT));
