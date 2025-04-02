// ✅ 加在你原本的 app.use(express.json()) 之後
app.post("/pp", async (req, res) => {
  try {
    const jobs = req.body.jobs || [];
    console.log(`📥 收到來自 ProxyPin 的預約單資料，共 ${jobs.length} 筆`);

    // ✅ Telegram Bot 設定
    const botToken = "7683067311:AAEGmT3gNK2Maoi1JKUXmRyOKbwT3OomIOk";
    const chatId = "1821018340";

    for (let i = 0; i < jobs.length; i++) {
      const job = jobs[i];
      const {
        userId = "未知", jobId, bookingTime, jobTime, canTakeTime,
        fare, on, off, note, extra, countdown
      } = job;

      // ✅ 伺服器 log 顯示
      console.log(`📌 第 ${i + 1} 筆預約單`);
      console.log(`🆔 使用者 ID: ${userId}`);
      console.log(`🔖 預約單ID: ${jobId}`);
      console.log(`📅 搭車時間: ${bookingTime}`);
      console.log(`⏰ 建立時間: ${jobTime}`);
      console.log(`📅 可接單時間: ${canTakeTime}`);
      console.log(`💰 車資: $${fare}`);
      console.log(`🚕 上車: ${on}`);
      console.log(`🛬 下車: ${off}`);
      console.log(`📝 備註: ${note}`);
      console.log(`📦 特殊需求: ${extra}`);
      console.log(`⏳ 倒數秒數: ${countdown} 秒`);
      console.log("──────────────────────────────");

      // ✅ 發送 Telegram 通知
      const message = `💰 ${fare} 元\n⏰ ${bookingTime}\n───────\n🚕 ${on}\n🛬 ${off}\n───────\n📝 ${note || "無"}\n📦 ${extra || "無"}\n⏳ 倒數：${countdown} 秒`;
      const url = `https://api.telegram.org/bot${botToken}/sendMessage`;

      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: message })
      });
    }

    res.status(200).send("✅ 已成功接收並通知 Telegram");

  } catch (e) {
    console.error("❌ 接收或解析失敗：", e.message);
    res.status(500).send("❌ Server 錯誤");
  }
});
