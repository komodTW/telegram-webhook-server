const express = require("express");
const app = express();
app.use(express.json());

app.get("/", (req, res) => {
  res.send("✅ Webhook Server 正常運作中");
});

// ✅ 新增：取得伺服器網路時間（精確到毫秒）
app.get("/time", (req, res) => {
  const serverTime = Date.now(); // 精確到毫秒
  const formatted = new Date(serverTime + 8 * 60 * 60 * 1000) // 台灣時間
    .toISOString()
    .replace("T", " ")
    .replace("Z", "");

  res.json({
    timeMs: serverTime,
    formatted: formatted
  });
});

// 接收 ProxyPin 傳來的預約單資料
app.post("/pp", async (req, res) => {
  try {
    const jobs = req.body.jobs || [];

    console.log(`📥 收到來自 ProxyPin 的預約單資料，共 ${jobs.length} 筆`);
    jobs.forEach((job, index) => {
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
    });

    res.status(200).send("✅ 已成功接收 ProxyPin 資料");
  } catch (e) {
    console.error("❌ 接收或解析失敗：", e.message);
    res.status(500).send("❌ Server 錯誤");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("🚀 Webhook Server 已啟動，Port:", PORT));
