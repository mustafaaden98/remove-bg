export const runtime = 'nodejs'; // Ensures Node.js runtime

export async function POST(request: Request) {
  const { username, isServer } = await request.json();

  console.log('isServer', isServer)


  const TELEGRAM_API_URL = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`;

  const textMessage = `
  📢 *New user send an api request*
  👤 Username: ${username}
      and background is removed by ${isServer ? 'server api' : 'transformer.js'}
      `;

  try {
    const response = await fetch(TELEGRAM_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: process.env.TELEGRAM_CHAT_ID,
        text: textMessage,
        parse_mode: "Markdown"
      })
    });

    const data = await response.json();
    return new Response(JSON.stringify(data), { status: 200 });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}
