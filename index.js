const express = require("express");
const axios = require("axios");
const app = express();
app.use(express.json());

const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;

app.post("/notify", async (req, res) => {
  const message = req.body.message || "🚕 有通知訊息但沒有內容";
  try {
    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      chat_id: CHAT_ID,
      text: message
    });
    res.status(200).send("✅ 訊息已送出");
  } catch (err) {
    console.error("❌ 傳送失敗：", err);
    res.status(500).send("❌ 傳送失敗");
  }
});

app.get("/", (req, res) => {
  res.send("✅ Webhook Server 正常運作中");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("🚀 Webhook Server 已啟動，Port:", PORT));
