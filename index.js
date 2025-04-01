const express = require("express");
const app = express();
app.use(express.json());

// 簡單測試用 GET 頁面
app.get("/", (req, res) => {
  res.send("✅ Webhook Server 正常運作中");
});

// 接收 ProxyPin 傳來的預約單資料
app.post("/pp", async (req, res) => {
  try {
    const jobs = req.body.jobs || [];
    console.log("📥 收到來自 ProxyPin 的預約單資料，共", jobs.length, "筆");

    jobs.forEach((job, index) => {
      console.log(`📌 第 ${index + 1} 筆預約單`);
      console.log(`🆔 預約單ID: ${job.jobId}`);
      console.log(`📅 搭車時間: ${job.bookingTime}`);
      console.log(`⏰ 建立時間: ${job.jobTime}`);
      console.log(`📅 可接單時間: ${job.canTakeTime}`);
      console.log(`💰 車資: $${job.fare}`);
      console.log(`🚕 上車: ${job.on}`);
      console.log(`🛬 下車: ${job.off}`);
      console.log(`📝 備註: ${job.note}`);
      console.log(`💳 付款代碼: ${job.pay}`);
      console.log(`🧳 特殊需求: ${job.extra}`);
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
