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
  console.log("🤖 Universal Gift Scraper Activated...");

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
      if (existing) { continue; }

      console.log(`✨ Processing New Post: ${postId}`);

      // 4. Save Post to DB
      await supabase.from('posts').insert({
        id: postId,
        title: post.title || 'No Title',
        body: rawBody,
        image_url: post.image_url || null,
        created_at: new Date(post.created_at * 1000 || Date.now()),
        url: postUrl
      });

      // 5. Link Discovery (Expanded for bit.ly)
      // Matches: herowars.me, hero-wars.com, bit.ly, tinyurl.com, goo.gl
      const linkRegex = /https?:\/\/(?:www\.)?(herowars\.me|hero-wars\.com|bit\.ly|tinyurl\.com|goo\.gl)\/[a-zA-Z0-9\?\=\&\-\_]+/g;
      const foundLinks = rawBody.match(linkRegex);

      if (foundLinks) {
        let confirmedGifts = [];

        for (const link of foundLinks) {
          // Remove trailing quotes/escaped chars if JSON.stringify added them
          const cleanLink = link.replace(/\\/g, ''); 
          
          const result = await validateGiftLink(cleanLink);
          
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

        // 6. Notification
        if (confirmedGifts.length > 0) {
          // Create a unique list (remove duplicates)
          const uniqueLinks = [...new Set(confirmedGifts)];
          const linksText = uniqueLinks.map(l => `[Click to Claim](${l})`).join('\n');
          
          const embed = {
            title: "🎁 New Gift Detected!",
            description: `${linksText}\n\n[View Original Post](${postUrl})`,
            color: 5763719, // Green
            footer: { text: "Hero Wars Data Hub" }
          };

          await sendDiscord(embed);
        }
      }
    }

  } catch (error) {
    console.error("❌ Error:", error.message);
  }
}

// 🕵️‍♂️ Validates if the link (or its redirect) has 'gift_id'
async function validateGiftLink(url) {
  try {
    console.log(`🔎 Checking: ${url}`);
    const response = await axios.get(url, { 
      headers: HEADERS,
      maxRedirects: 5, // Follows bit.ly -> herowars automatically
      validateStatus: status => status < 400 
    });

    const finalUrl = response.request.res.responseUrl || url;
    
    // THE CHECK: Does the final destination have "gift_id=" ?
    if (finalUrl.includes('gift_id=')) {
      const idMatch = finalUrl.match(/gift_id=([a-zA-Z0-9]+)/);
      const giftId = idMatch ? idMatch[1] : 'Unknown';
      return { isValid: true, finalUrl: finalUrl, giftId: giftId };
    }

    return { isValid: false };

  } catch (e) {
    console.log(`Link check failed for ${url}: ${e.message}`);
    return { isValid: false };
  }
}

async function sendDiscord(embed) {
  if (!DISCORD_WEBHOOK) return;
  try { await axios.post(DISCORD_WEBHOOK, { embeds: [embed] }); } 
  catch (e) { console.error("Discord Error"); }
}

run();