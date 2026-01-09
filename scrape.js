const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK_URL;
const API_URL = 'https://community-api.hero-wars.com/api/posts/published?page=1';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
};

async function run() {
  console.log("🤖 Hero Wars Scraper: ALWAYS SCAN MODE");

  try {
    const response = await axios.get(API_URL, { headers: HEADERS });
    const posts = response.data.results || response.data || [];

    for (const post of posts) {
      const postId = post.id;
      const rawBody = JSON.stringify(post).replace(/\\/g, ''); 
      const postUrl = `https://community.hero-wars.com/post/${postId}`;

      // 1. Ensure Post is in DB (Upsert = Insert or Update)
      await supabase.from('posts').upsert({
        id: postId,
        title: post.title || 'No Title',
        body: rawBody,
        image_url: post.image_url || null,
        created_at: new Date(post.created_at * 1000 || Date.now()),
        url: postUrl
      });

      // 2. Scan for Links (WE DO NOT SKIP THE POST ANYMORE)
      const linkRegex = /https?:\/\/(?:www\.)?(herowars\.me|hero-wars\.com|bit\.ly|tinyurl\.com|goo\.gl)\/[a-zA-Z0-9\?\=\&\-\_]+/g;
      const foundLinks = rawBody.match(linkRegex);

      if (foundLinks) {
        const uniqueLinks = [...new Set(foundLinks)];
        let newGiftsFound = [];

        for (const link of uniqueLinks) {
          // 3. Validate Link
          const result = await validateGiftLink(link);
          
          if (result.isValid) {
            // 4. Check if this specific GIFT URL is already in DB
            // We check the 'gift_url' column to see if we have processed this specific reward before
            const { data: giftExists } = await supabase
              .from('gifts')
              .select('id')
              .eq('gift_url', result.finalUrl)
              .single();

            if (!giftExists) {
              console.log(`✅ NEW GIFT FOUND: ${result.giftId}`);
              
              // Insert into DB
              await supabase.from('gifts').insert({ 
                post_id: postId, 
                gift_url: result.finalUrl, 
                is_active: true 
              });

              // Add to list for Discord
              newGiftsFound.push(result.finalUrl);
            } else {
              // We already have this gift, so we stay silent
              console.log(`   (Gift ${result.giftId} already in DB)`);
            }
          }
        }

        // 5. Send Discord (Only if we found NEW gifts)
        if (newGiftsFound.length > 0) {
          console.log("🚀 Sending to Discord...");
          
          const linksText = newGiftsFound.map(l => `[👉 Click Here to Claim Gift](${l})`).join('\n');
          
          const embed = {
            title: "🎁 New Gift Detected!",
            description: `${linksText}\n\n[Source Post](${postUrl})`,
            color: 5763719,
            footer: { text: "Hero Wars Data Hub" },
            timestamp: new Date().toISOString()
          };

          await sendDiscord(embed);
        }
      }
    }

  } catch (error) {
    console.error("❌ Error:", error.message);
  }
}

async function validateGiftLink(url) {
  try {
    const response = await axios.get(url, { 
      headers: HEADERS,
      maxRedirects: 5, 
      validateStatus: status => status < 400 
    });

    const finalUrl = response.request.res.responseUrl || url;
    
    // STRICT VALIDATION: Must have 'gift_id='
    if (finalUrl.includes('gift_id=')) {
      const idMatch = finalUrl.match(/gift_id=([a-zA-Z0-9]+)/);
      const giftId = idMatch ? idMatch[1] : 'Unknown';
      return { isValid: true, finalUrl: finalUrl, giftId: giftId };
    }

    return { isValid: false };

  } catch (e) {
    return { isValid: false };
  }
}

async function sendDiscord(embed) {
  if (!DISCORD_WEBHOOK) {
    console.log("❌ No Discord Webhook URL provided.");
    return;
  }
  try { 
    await axios.post(DISCORD_WEBHOOK, { embeds: [embed] }); 
    console.log("✅ Discord Message Sent.");
  } 
  catch (e) { 
    console.error("❌ Discord Failed:", e.message); 
    // Fallback: Try sending plain text if embed fails
    try { await axios.post(DISCORD_WEBHOOK, { content: `🎁 **New Gift!**\n${embed.description}` }); } catch (z) {}
  }
}

run();