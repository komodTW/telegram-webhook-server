const express = require("express");
const axios = require("axios");
const app = express();
app.use(express.json());

const TELEGRAM_TOKEN = "7683067311:AAEGmT3gNK2Maoi1JKUXmRyOKbwT3OomIOk";
const TELEGRAM_CHAT_ID = "1821018340";

// ✅ 已通知資料的快取（key = jobId，value = 完整內容 JSON 字串）
const notifiedMap = new Map();

// ✅ 伺服器時間 API
app.get("/time", (req, res) => {
  const now = Date.now();
  const formatted = new Date(now + 8 * 60 * 60 * 1000)
    .toISOString()
    .replace("T", " ")
    .replace("Z", "");
  res.json({ timeMs: now, formatted });
});

// ✅ ProxyPin 傳入預約單資料
app.post("/pp", async (req, res) => {
  try {
    const jobs = req.body.jobs || [];
    console.log(`📥 收到 ProxyPin 預約單，共 ${jobs.length} 筆`);

    for (const [index, job] of jobs.entries()) {
      const jobId = job.jobId;
      const jobJson = JSON.stringify(job);

      if (notifiedMap.has(jobId) && notifiedMap.get(jobId) === jobJson) {
        console.log(`⏭️ 預約單 ${jobId} 無變動，略過通知`);
        continue; // 資料沒變就跳過
      }

      // ✅ 更新已通知快取
      notifiedMap.set(jobId, jobJson);

      // ✅ 日誌列出
      console.log(`📌 第 ${index + 1} 筆預約單`);
      console.log(`🆔 使用者 ID: ${job.userId || "未知"}`);
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

      // ✅ 發送通知給 Telegram
      const message = `💰 $${job.fare}\n🕓 ${job.bookingTime}\n——————————————\n🚕 ${job.on}\n🛬 ${job.off}\n——————————————\n${job.note}`;
      await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: "Markdown"
      });

      console.log(`📤 已通知 Telegram: 預約單 ${jobId}`);
    }

    res.status(200).send("✅ 已處理所有預約單資料");
  } catch (e) {
    console.error("❌ 錯誤：", e.message);
    res.status(500).send("❌ Server 錯誤");
  }
});

// ✅ 伺服器啟動
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🚀 Webhook Server 已啟動，Port: ${PORT}`);
});
