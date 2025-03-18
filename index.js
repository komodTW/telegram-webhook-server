const express = require("express");
const axios = require("axios");
const app = express();
app.use(express.json());

const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;

app.post("/notify", async (req, res) => {
  // 接收來自 Frida 的金額資訊
  const fare = req.body.fare || 0;  // 金額默認為 0
  const message = req.body.message || "🚕 有通知訊息但沒有內容";

  console.log("收到金額:", fare);

  // 如果金額大於 400，則發送通知
  if (fare > 400) {
    const notificationMessage = `💰 高額預約單：${fare}元`;

    try {
      // 發送 Telegram 訊息
      await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        chat_id: CHAT_ID,
        text: notificationMessage
      });
      res.status(200).send("✅ 訊息已送出");
    } catch (err) {
      console.error("❌ 傳送失敗：", err);
      res.status(500).send("❌ 傳送失敗");
    }
  } else {
    res.status(200).send("🚫 金額未達標準，無需發送通知");
  }
});

app.get("/", (req, res) => {
  res.send("✅ Webhook Server 正常運作中");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("🚀 Webhook Server 已啟動，Port:", PORT));
