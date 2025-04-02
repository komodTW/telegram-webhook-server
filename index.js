const express = require("express");
const fetch = require("node-fetch");
const app = express();
app.use(express.json());

const TELEGRAM_BOT_TOKEN = "7683067311:AAEGmT3gNK2Maoi1JKUXmRyOKbwT3OomIOk";
const CHAT_ID = "1821018340";

// 格式化金額為千分位表示
function formatCurrency(amount) {
  return `$ ${amount.toLocaleString("en-US")}`;
}

// 格式化日期時間
function formatDateTime(dateTime) {
  const date = new Date(dateTime);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const time = date.toTimeString().split(" ")[0].substring(0, 5);
  return `${month}/${day} ${time}`;
}

// 發送通知到 Telegram
async function sendTelegramNotification(job) {
  const fare = formatCurrency(job.fare);
  const bookingTime = formatDateTime(job.bookingTime);
  const canTakeTime = new Date(job.canTakeTime).toISOString().replace("T", " ").replace("Z", "");
  const countdown = job.countdown ?? 0;
  const note = job.note || "無";
  const extra = job.extra || "無";

  const message = `
💰 **${fare}**
🕓 **${bookingTime}**
──────────────────
🚕 ${job.on}
🛬 ${job.off}
──────────────────
📝 備註：${note}
📦 特殊需求：${extra}
──────────────────
🆔 用戶 ID：${job.userId}
🔖 預約單ID：${job.jobId}
📲 可接單時間: ${canTakeTime}
⏳ 倒數秒數：**${countdown}** 秒
`;

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const payload = {
    chat_id: CHAT_ID,
    text: message,
    parse_mode: "Markdown",
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!data.ok) {
      console.error("❌ 無法發送 Telegram 訊息：", data.description);
    } else {
      console.log("✅ 成功發送 Telegram 訊息");
    }
  } catch (error) {
    console.error("❌ 發送 Telegram 訊息時發生錯誤：", error.message);
  }
}

app.post("/pp", async (req, res) => {
  try {
    const jobs = req.body.jobs || [];

    console.log(`📥 收到來自 ProxyPin 的預約單資料，共 ${jobs.length} 筆`);
    for (const job of jobs) {
      await sendTelegramNotification(job);
    }

    res.status(200).send("✅ 已成功接收並通知 Telegram");
  } catch (e) {
    console.error("❌ 接收或處理失敗：", e.message);
    res.status(500).send("❌ 伺服器錯誤");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("🚀 Webhook 伺服器已啟動，埠號：", PORT));
