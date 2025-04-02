const express = require("express");
const fetch = require("node-fetch");
const app = express();
app.use(express.json());

// ✅ Telegram 設定
const TELEGRAM_BOT_TOKEN = "7683067311:AAEGmT3gNK2Maoi1JKUXmRyOKbwT3OomIOk";
const TELEGRAM_CHAT_ID = "1821018340";

// ✅ 根路由
app.get("/", (req, res) => {
  res.send("✅ Webhook Server 正常運作中");
});

// ✅ 網路時間 API
app.get("/time", (req, res) => {
  const serverTime = Date.now();
  const formatted = new Date(serverTime + 8 * 60 * 60 * 1000)
    .toISOString().replace("T", " ").replace("Z", "");
  res.json({ timeMs: serverTime, formatted });
});

// ✅ 接收 ProxyPin 資料
app.post("/pp", async (req, res) => {
  try {
    const jobs = req.body.jobs || [];
    console.log(`📥 收到 ProxyPin 預約單，共 ${jobs.length} 筆`);

    for (let i = 0; i < jobs.length; i++) {
      const job = jobs[i];

      console.log(`📌 第 ${i + 1} 筆`);
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
      console.log(`⏳ 倒數: ${job.countdown} 秒`);
      console.log("──────────────────────────────");

      // ✅ 發送 Telegram 通知
      const msg = `💰 $${job.fare}\n🕐 ${job.bookingTime}\n―――――――――\n🚕 ${job.on}\n🛬 ${job.off}\n―――――――――\n${job.note || ""}`;
      const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: TELEGRAM_CHAT_ID,
          text: msg,
          parse_mode: "Markdown"
        }),
      });
    }

    res.status(200).send("✅ 成功接收與通知");
  } catch (e) {
    console.error("❌ 發生錯誤：", e.message);
    res.status(500).send("❌ Server 錯誤");
  }
});

// ✅ 啟動伺服器
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("🚀 Webhook Server 已啟動，Port:", PORT);
});
