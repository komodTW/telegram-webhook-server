// ✅ 發送 Telegram 訊息並啟動倒數
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
────────────
🚕 ${job.on}
🛬 ${job.off}
────────────
📝 備註：${note}
📦 特殊需求：${extra}
────────────
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

  // 發送初始訊息
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

    // 預設要更新的倒數秒數
    const updateAt = [20, 15, 10, 5];

    updateAt.forEach((sec) => {
      if (countdown > sec) {
        const delay = (countdown - sec) * 1000;
        setTimeout(() => {
          updateMessageText(job.chat_id || CHAT_ID, message_id, messageText(sec), replyMarkup);
        }, delay);
      }
    });

    // 最後倒數為 0 秒 → 結束並移除按鈕
    if (countdown > 0) {
      setTimeout(() => {
        const finalText = `⛔ 時間已截止，無法接單\n\n${messageText(0)}`;
        updateMessageText(job.chat_id || CHAT_ID, message_id, finalText, null); // 移除按鈕
      }, countdown * 1000);
    }

  } catch (err) {
    console.error("❌ 發送 Telegram 訊息時發生錯誤：", err.message);
  }
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
