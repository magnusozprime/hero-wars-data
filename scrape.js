const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

// 1. Setup Connections
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK_URL;
const API_URL = 'https://community-api.hero-wars.com/api/posts/published?page=1';

// Headers to mimic a real browser
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
};

async function run() {
  console.log("🤖 Gift-Only Scraper Activated...");

  try {
    // 2. Fetch Feed
    const response = await axios.get(API_URL, { headers: HEADERS });
    const posts = response.data.results || response.data || [];

    for (const post of posts) {
      const postId = post.id;
      const rawBody = JSON.stringify(post);
      const postUrl = `https://community.hero-wars.com/post/${postId}`;

      // 3. Database Check (Prevent Duplicates)
      const { data: existing } = await supabase.from('posts').select('id').eq('id', postId).single();
      if (existing) {
        // Post already handled. Skip.
        continue; 
      }

      console.log(`✨ Processing New Post: ${postId}`);

      // 4. Save Post to DB (So we don't check it again next time)
      await supabase.from('posts').insert({
        id: postId,
        title: post.title || 'No Title',
        body: rawBody,
        image_url: post.image_url || null,
        created_at: new Date(post.created_at * 1000 || Date.now()),
        url: postUrl
      });

      // 5. Link Discovery (Only herowars.me and hero-wars.com)
      const linkRegex = /(https:\/\/herowars\.me\/[a-zA-Z0-9]+)|(https:\/\/www\.hero-wars\.com\/\?[\w=&]+)/g;
      const foundLinks = rawBody.match(linkRegex);

      if (foundLinks) {
        let confirmedGifts = [];

        for (const link of foundLinks) {
          const result = await validateGiftLink(link);
          
          if (result.isValid) {
            console.log(`✅ GIFT CONFIRMED: ${result.giftId}`);
            
            // Save Gift to DB
            await supabase.from('gifts').insert({ 
              post_id: postId, 
              gift_url: result.finalUrl, 
              is_active: true 
            });
            
            confirmedGifts.push(result.finalUrl);
          }
        }

        // 6. Notification - ONLY if gifts were found
        if (confirmedGifts.length > 0) {
          // Format links nicely for Discord
          const linksText = confirmedGifts.map(l => `[Click to Claim](${l})`).join('\n');
          
          const embed = {
            title: "🎁 New Gift Detected!",
            description: `${linksText}\n\n[View Original Post](${postUrl})`,
            color: 5763719, // Green color
            footer: { text: "Hero Wars Data Hub" }
          };

          await sendDiscord(embed);
        }
      }
      // NO 'ELSE' BLOCK HERE. If no gift, we stay silent.
    }

  } catch (error) {
    console.error("❌ Error:", error.message);
  }
}

// 🕵️‍♂️ Validates if the link has 'gift_id'
async function validateGiftLink(url) {
  try {
    const response = await axios.get(url, { 
      headers: HEADERS,
      maxRedirects: 5,
      validateStatus: status => status < 400 
    });

    const finalUrl = response.request.res.responseUrl || url;
    
    if (finalUrl.includes('gift_id=')) {
      const idMatch = finalUrl.match(/gift_id=([a-zA-Z0-9]+)/);
      const giftId = idMatch ? idMatch[1] : 'Unknown';
      return { isValid: true, finalUrl: finalUrl, giftId: giftId };
    }

    return { isValid: false };

  } catch (e) {
    console.log(`Link check failed: ${e.message}`);
    return { isValid: false };
  }
}

async function sendDiscord(embed) {
  if (!DISCORD_WEBHOOK) return;
  try { 
    // Sending as an Embed for a professional look
    await axios.post(DISCORD_WEBHOOK, { embeds: [embed] }); 
  } 
  catch (e) { console.error("Discord Error"); }
}

run();